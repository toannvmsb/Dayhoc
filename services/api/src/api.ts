import { asChildId, type Evidence, type GradeContext, type Role, type TeacherContribution } from '@copilot/domain';
import { EvidenceService, InMemoryLedgerStore, type LedgerStore } from '@copilot/evidence';
import { loadKnowledgeBase, type KnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import { buildDailyPlan } from '@copilot/planning';
import { buildAssignmentsForPlan } from '@copilot/practice';
import {
  assertChildSafe,
  buildChildToday,
  buildParentGapDetail,
  buildParentHome,
  buildParentProgress,
  type ChildProfileInput,
} from '@copilot/projections';
import { createLogger, type Logger } from '@copilot/observability';
import type { EvidenceInput, TeacherContributionInput } from '@copilot/schemas';

export interface RequestContext {
  readonly userId: string;
  readonly role: Role;
  /** For a child token: the single child this token is scoped to. */
  readonly childScope?: string;
}

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
    }
  >;
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
  const evidenceService = new EvidenceService({ store: ledger, logger });

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

  async function scene(childId: string) {
    const rec = deps.childProfiles[childId]!;
    const stored = await evidenceService.history(childId);
    const evidence = [...(rec.seedEvidence ?? []), ...stored];
    const contributions = [
      ...(rec.seedContributions ?? []),
      ...(await evidenceService.teacherContributions(childId)),
    ];
    const asOf = now();
    const twin = buildLearningTwin({ childId: asChildId(childId), gradeContext: rec.gradeContext, evidence, knowledgeBase: kb, asOf });
    const gaps = runGapEngine({ childId: asChildId(childId), gradeContext: rec.gradeContext, twin, evidence, knowledgeBase: kb, asOf });
    const context = buildLearningContext({ childId: asChildId(childId), gradeContext: rec.gradeContext, evidence, teacherContributions: contributions, knowledgeBase: kb, asOf });
    const plan = buildDailyPlan({ childId: asChildId(childId), planDate: asOf.toISOString().slice(0, 10), availableMinutes: 25, twin, gaps, context, knowledgeBase: kb, asOf });
    return { rec, twin, gaps, context, plan, asOf };
  }

  return {
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
      return evidenceService.recordTeacherContribution({ ...input, childId });
    },
  };
}

function requireParent(ctx: RequestContext): void {
  if (ctx.role !== 'parent' && ctx.role !== 'admin') {
    throw new AuthzError('parent endpoint requires a parent token');
  }
}
