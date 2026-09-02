import { asChildId, type AiGenerationMode, type Evidence, type GradeContext, type Role, type TeacherContribution } from '@copilot/domain';
import { EvidenceService, InMemoryLedgerStore, type LedgerStore } from '@copilot/evidence';
import { loadKnowledgeBase, type KnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext, evaluatePace } from '@copilot/learning-context';
import { CurriculumClockService, toExpectedLearningContext } from '@copilot/curriculum-clock';
import { buildDailyPlan, buildExerciseGenerationSpec } from '@copilot/planning';
import { buildAssignmentsForPlan } from '@copilot/practice';
import type { ExerciseGenerator, GenerationStore, ShadowGenerationQueue, UsageContext } from '@copilot/exercise-gen';
import type { ReferenceExample } from '@copilot/reference-library';
import {
  assertChildSafe,
  buildChildToday,
  buildParentGapDetail,
  buildParentHome,
  buildParentProgress,
  type ChildProfileInput,
} from '@copilot/projections';
import { createLogger, type Logger } from '@copilot/observability';
import type {
  AuthorizationService,
  IdentityService,
  Resource,
  WorkspaceRequestContext,
} from '@copilot/identity';
import type { EvidenceInput, TeacherContributionInput } from '@copilot/schemas';

export interface RequestContext {
  readonly userId: string;
  readonly role: Role;
  /** For a child token: the single child this token is scoped to. */
  readonly childScope?: string;
  /**
   * I7: the workspace this context was derived from (set by `contextFromToken`).
   * When present + `deps.auth.authorization` is configured, child routes run the
   * relationship-aware `authorize()` gate in addition to family scope.
   */
  readonly workspace?: 'PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN';
}

const WORKSPACE_TO_ROLE: Record<'PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN', Role> = {
  PARENT: 'parent',
  STUDENT: 'child',
  TEACHER: 'teacher',
  ADMIN: 'admin',
};

export class AuthzError extends Error {
  readonly status = 403;
}
export class NotFoundError extends Error {
  readonly status = 404;
}

export interface ApiDeps {
  readonly ledger?: LedgerStore;
  readonly knowledgeBase?: KnowledgeBase;
  readonly logger?: Logger;
  readonly now?: () => Date;
  /** Demo/seed child profiles + grade + seed evidence + contributions. */
  readonly childProfiles: Record<
    string,
    {
      readonly profile: ChildProfileInput;
      readonly gradeContext: GradeContext;
      readonly familyUserIds: readonly string[];
      readonly seedEvidence?: readonly Evidence[];
      readonly seedContributions?: readonly TeacherContribution[];
      /** School enrollment — the Curriculum Clock's input (doc 13). */
      readonly enrollment?: {
        readonly curriculum: string; // KET_NOI_TRI_THUC
        readonly academicYear: string; // 2026-2027
        readonly calendarId?: string;
      };
    }
  >;
  /** Persisted per-child applied pace_delta (doc 13 §4). Default 0. */
  readonly appliedPaceDeltaFor?: (childId: string) => number;
  /**
   * I7 auth/workspace foundation (doc 22). When present, `contextFromToken`
   * derives a `RequestContext` server-side from a verified bearer token, and
   * `authorize` runs the relationship-aware gate. When absent the API keeps the
   * legacy trusted-`RequestContext` path (dev/test only — `TRUSTED_CONTEXT`).
   */
  readonly auth?: {
    readonly identityService: IdentityService;
    readonly authorization?: AuthorizationService;
  };
  /**
   * Live AI generation in SHADOW mode (doc 14 C5 §11). When `mode === 'SHADOW'`
   * a full generation pipeline runs in parallel with the legacy child path via
   * `queue` — the result NEVER enters the child-visible Assignment. When absent
   * or `mode !== 'SHADOW'` nothing extra runs. `mode === 'LIVE'` is reserved
   * and behaves like OFF here (never delivers AI content to a child).
   */
  readonly shadowGeneration?: {
    readonly mode: AiGenerationMode;
    readonly queue: ShadowGenerationQueue;
    readonly generator: ExerciseGenerator;
    readonly referenceLibrary: readonly ReferenceExample[];
    readonly store?: GenerationStore;
    readonly resolveUsageContext?: (childId: string, ctx: RequestContext) => UsageContext;
  };
}

/**
 * The API surface — role-gated handlers over the deterministic pipeline.
 *
 * - a parent/teacher token may only touch children in their family
 * - a CHILD token is scoped to one child and can ONLY reach child-safe views;
 *   every child response also passes `assertChildSafe` before return (defense in
 *   depth on top of the projection's type-level guarantee)
 * - every write goes through the append-only EvidenceService
 */
export function createApi(deps: ApiDeps) {
  const kb = deps.knowledgeBase ?? loadKnowledgeBase();
  const ledger = deps.ledger ?? new InMemoryLedgerStore();
  const logger = deps.logger ?? createLogger({ level: 'warn' });
  const now = deps.now ?? (() => new Date());
  const evidenceService = new EvidenceService({ store: ledger, logger, now });

  function requireChildAccess(ctx: RequestContext, childId: string): void {
    const rec = deps.childProfiles[childId];
    if (!rec) throw new NotFoundError(`unknown child ${childId}`);
    if (ctx.role === 'admin') return;
    if (ctx.role === 'child') {
      if (ctx.childScope !== childId) throw new AuthzError('child token is scoped to another child');
      return;
    }
    if (ctx.role === 'parent' || ctx.role === 'teacher') {
      if (!rec.familyUserIds.includes(ctx.userId)) throw new AuthzError('not in this child family');
      return;
    }
    throw new AuthzError('role not permitted');
  }

  const clock = new CurriculumClockService((child) => deps.appliedPaceDeltaFor?.(child.curriculum) ?? 0);

  /**
   * Build an `ExerciseGenerationSpec` for the current scene and enqueue a shadow
   * generation job. NEVER throws (SHADOW failure is telemetry, not user-facing);
   * NEVER awaited by the request handler.
   */
  function maybeRunShadowGeneration(
    ctx: RequestContext,
    childId: string,
    s: Awaited<ReturnType<typeof scene>>,
  ): void {
    const sg = deps.shadowGeneration;
    if (!sg || sg.mode !== 'SHADOW' || s.plan.kind !== 'plan') return;
    try {
      const spec = buildExerciseGenerationSpec({
        childId: asChildId(childId),
        gradeContext: s.rec.gradeContext,
        twin: s.twin,
        gaps: s.gaps,
        context: s.context,
        knowledgeBase: kb,
        availableMinutes: 25,
        asOf: s.asOf,
      });
      sg.queue.enqueue({
        spec,
        generator: sg.generator,
        referenceLibrary: sg.referenceLibrary,
        knowledgeBase: kb,
        ...(sg.store ? { store: sg.store } : {}),
        ...(sg.resolveUsageContext ? { usageContext: sg.resolveUsageContext(childId, ctx) } : {}),
      });
    } catch (err) {
      logger.warn('shadow generation enqueue failed', { childId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function scene(childId: string) {
    const rec = deps.childProfiles[childId]!;
    const stored = await evidenceService.history(childId);
    const evidence = [...(rec.seedEvidence ?? []), ...stored];
    const contributions = [
      ...(rec.seedContributions ?? []),
      ...(await evidenceService.teacherContributions(childId)),
    ];
    const lessonConfirmations = await evidenceService.lessonConfirmations(childId);
    const asOf = now();

    // Curriculum Clock estimate (works with zero parent/teacher input) — doc 13.
    const enroll = rec.enrollment;
    const gradeNum = rec.gradeContext === 7 ? 7 : 4;
    const clockChild = enroll
      ? { curriculum: enroll.curriculum, grade: gradeNum as 4 | 7, academicYear: enroll.academicYear, ...(enroll.calendarId ? { calendarId: enroll.calendarId } : {}) }
      : null;
    const baseClock = clockChild ? clock.positionFor(clockChild, asOf) : null;

    // Curriculum-pace policy (doc 13 §4): an explicit override wins; otherwise the
    // system may auto-apply a LOW-confidence pace once evidence is consistent
    // enough. Only shifts the FUTURE estimate — never verified actual context.
    const externalPace = deps.appliedPaceDeltaFor?.(childId) ?? 0;
    const pace = evaluatePace({
      expected: baseClock ? toExpectedLearningContext(baseClock) : null,
      evidence,
      lessonConfirmations,
      knowledgeBase: kb,
      asOf,
    });
    const appliedPaceDelta = externalPace !== 0 ? externalPace : pace.autoApply.applied ? pace.autoApply.value : 0;
    const effectiveClock =
      clockChild && appliedPaceDelta !== 0
        ? clock.positionFor(clockChild, asOf, { paceDeltaOverride: appliedPaceDelta })
        : baseClock;
    const expectedContext = effectiveClock ? toExpectedLearningContext(effectiveClock) : null;

    const twin = buildLearningTwin({ childId: asChildId(childId), gradeContext: rec.gradeContext, evidence, knowledgeBase: kb, asOf });
    const gaps = runGapEngine({ childId: asChildId(childId), gradeContext: rec.gradeContext, twin, evidence, knowledgeBase: kb, asOf });
    const context = buildLearningContext({
      childId: asChildId(childId),
      gradeContext: rec.gradeContext,
      evidence,
      teacherContributions: contributions,
      lessonConfirmations,
      expectedContext,
      appliedPaceDelta,
      paceEvaluation: pace,
      knowledgeBase: kb,
      asOf,
    });
    const plan = buildDailyPlan({ childId: asChildId(childId), planDate: asOf.toISOString().slice(0, 10), availableMinutes: 25, twin, gaps, context, knowledgeBase: kb, asOf });
    return { rec, twin, gaps, context, plan, asOf };
  }

  /**
   * Derive a `RequestContext` from a verified bearer token (doc 22 §4). The
   * client never asserts its own userId/role/childScope on this path. Throws
   * `AuthzError` (401-ish) when the token is invalid or the workspace is not held.
   */
  async function contextFromToken(
    bearer: string,
    workspace: 'PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN',
  ): Promise<RequestContext> {
    if (!deps.auth) throw new AuthzError('token auth is not configured');
    const session = await deps.auth.identityService.sessionContext(bearer, workspace);
    if (!session) throw new AuthzError('invalid or expired token');
    return {
      userId: session.userId,
      role: WORKSPACE_TO_ROLE[workspace],
      workspace,
      ...(session.childScope !== undefined ? { childScope: session.childScope } : {}),
    };
  }

  /**
   * The relationship-aware authorization gate (doc 22 §5). A no-op unless the
   * context was token-derived (`ctx.workspace` set) AND `deps.auth.authorization`
   * is configured — otherwise the legacy `requireChildAccess` family scope is the
   * only control (dev/test).
   */
  async function authorizeChild(ctx: RequestContext, childId: string, action: string, subjectId?: string): Promise<void> {
    if (!ctx.workspace || !deps.auth?.authorization) return;
    const resource: Resource = { kind: 'child', childId, ...(subjectId ? { subjectId } : {}) };
    const wctx: WorkspaceRequestContext = {
      userId: ctx.userId,
      workspace: ctx.workspace,
      ...(ctx.childScope !== undefined ? { childScope: ctx.childScope } : {}),
    };
    await deps.auth.authorization.authorize(wctx, resource, action);
  }

  return {
    /** GET /me/roles — the workspaces this identity may switch into (doc 25 §1). */
    async meRoles(bearer: string) {
      if (!deps.auth) throw new AuthzError('token auth is not configured');
      const resolved = await deps.auth.identityService.authenticate(bearer);
      if (!resolved) throw new AuthzError('invalid or expired token');
      return {
        userId: resolved.user.id,
        roles: resolved.roles,
        hasParentProfile: resolved.parentProfile !== null,
        hasTeacherProfile: resolved.teacherProfile !== null,
        defaultWorkspace: resolved.roles.includes('PARENT')
          ? 'PARENT'
          : (resolved.roles[0] ?? null),
      };
    },

    /** POST /me/switch-workspace — validates workspace ∈ held roles, returns the context. */
    async switchWorkspace(bearer: string, workspace: 'PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN') {
      return contextFromToken(bearer, workspace);
    },

    contextFromToken,

    /** GET /children/:id/home — parent only. */
    async parentHome(ctx: RequestContext, childId: string) {
      requireParent(ctx);
      requireChildAccess(ctx, childId);
      const s = await scene(childId);
      return buildParentHome({ profile: s.rec.profile, twin: s.twin, gaps: s.gaps, context: s.context, plan: s.plan, knowledgeBase: kb });
    },

    async parentProgress(ctx: RequestContext, childId: string) {
      requireParent(ctx);
      requireChildAccess(ctx, childId);
      const s = await scene(childId);
      return buildParentProgress({ profile: s.rec.profile, twin: s.twin, gaps: s.gaps, context: s.context, plan: s.plan, knowledgeBase: kb });
    },

    async parentGapDetail(ctx: RequestContext, childId: string, gapId: string) {
      requireParent(ctx);
      requireChildAccess(ctx, childId);
      const s = await scene(childId);
      const view = buildParentGapDetail({ profile: s.rec.profile, twin: s.twin, gaps: s.gaps, context: s.context, plan: s.plan, knowledgeBase: kb }, gapId);
      if (!view) throw new NotFoundError('gap not found');
      return view;
    },

    /** GET /child/today — child token only; response is asserted child-safe. */
    async childToday(ctx: RequestContext, childId: string) {
      if (ctx.role !== 'child') throw new AuthzError('child endpoint requires a child token');
      requireChildAccess(ctx, childId);
      const s = await scene(childId);
      const assignments =
        s.plan.kind === 'plan'
          ? buildAssignmentsForPlan(s.plan, s.twin, s.asOf.toISOString(), (() => { let i = 0; return () => `${++i}`; })())
          : [];
      const view = buildChildToday({
        childDisplayName: s.rec.profile.displayName,
        dateLabel: s.asOf.toISOString().slice(0, 10),
        plan: s.plan,
        assignments,
        completedAssignmentIds: [],
      });
      assertChildSafe(view);

      // SHADOW mode (doc 14 C5 §11/§12): kick off a parallel AI generation that
      // the child NEVER sees. Everything here is best-effort and cannot touch
      // `view` — a spec-build error or a full queue is swallowed, not surfaced.
      maybeRunShadowGeneration(ctx, childId, s);

      return view;
    },

    /** POST /children/:id/evidence — parent/teacher/admin. */
    async recordEvidence(ctx: RequestContext, childId: string, input: EvidenceInput) {
      if (ctx.role === 'child') throw new AuthzError('child token cannot write evidence directly');
      requireChildAccess(ctx, childId);
      return evidenceService.record({ ...input, childId });
    },

    /** POST /children/:id/teacher-update — teacher OR parent proxy. */
    async recordTeacherUpdate(ctx: RequestContext, childId: string, input: TeacherContributionInput) {
      if (ctx.role !== 'teacher' && ctx.role !== 'parent' && ctx.role !== 'admin') throw new AuthzError('not permitted');
      requireChildAccess(ctx, childId);
      // I7: a token-derived TEACHER context is additionally checked against the
      // scoped permission for the contribution (doc 21 §7 / §3.1).
      if (ctx.workspace === 'TEACHER') {
        await authorizeChild(ctx, childId, 'submit_current_lesson');
      }
      return evidenceService.recordTeacherContribution({ ...input, childId });
    },

    /**
     * GET /children/:id/learning-context — parent/teacher. Returns the calendar
     * ESTIMATE and the RESOLVED context as clearly separate things. ESTIMATED is
     * never presented as fact.
     */
    async learningContext(ctx: RequestContext, childId: string) {
      if (ctx.role === 'child') throw new AuthzError('child token cannot read learning context');
      requireChildAccess(ctx, childId);
      if (ctx.workspace === 'TEACHER') await authorizeChild(ctx, childId, 'view_learning_context');
      const s = await scene(childId);
      return {
        childId,
        builtAt: s.context.builtAt,
        expected: s.context.expected, // dự kiến theo chương trình (ESTIMATED) — hoặc null
        resolved: s.context.resolved, // đã xác nhận / quan sát thực tế
        paceDelta: s.context.paceDelta,
        paceDeltaHypothesis: s.context.paceDeltaHypothesis,
        conflicts: s.context.conflicts,
        calendar: s.context.expected?.calendar ?? null,
      };
    },

    /**
     * POST /children/:id/confirm-lesson — parent/teacher confirm or correct the
     * current lesson. APPENDS a `LessonConfirmationEvent` (never overwrites
     * history) and returns the re-resolved context.
     */
    async confirmLesson(
      ctx: RequestContext,
      childId: string,
      input: { lessonId: string; topicNote?: string; confidence?: 'VERIFIED' | 'STRONG' | 'SUPPORTING' },
    ) {
      if (ctx.role !== 'teacher' && ctx.role !== 'parent' && ctx.role !== 'admin') throw new AuthzError('not permitted');
      requireChildAccess(ctx, childId);
      if (!kb.curriculum.has(input.lessonId)) throw new NotFoundError(`unknown lesson ${input.lessonId}`);
      const event = await evidenceService.recordLessonConfirmation({
        childId,
        lessonId: input.lessonId,
        ...(input.topicNote !== undefined ? { topicNote: input.topicNote } : {}),
        source: ctx.role === 'teacher' ? 'TEACHER_UPDATE' : 'PARENT_UPDATE',
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        confirmedBy: ctx.userId,
      });
      const s = await scene(childId);
      return { event, resolved: s.context.resolved, expected: s.context.expected };
    },
  };
}

function requireParent(ctx: RequestContext): void {
  if (ctx.role !== 'parent' && ctx.role !== 'admin') {
    throw new AuthzError('parent endpoint requires a parent token');
  }
}
