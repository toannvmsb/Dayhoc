import type { Pool, PoolClient } from 'pg';
import type { PermissionCode, TeacherContribution } from '@copilot/domain';
import {
  AuthorizationService,
  DiscoveryService,
  FamilyService,
  IdentityService,
  PermissionService,
  RelationshipService,
  TeacherContributionService,
  educationClassContextReader,
  SupabaseAuthAdapter,
  type AuthAdapter,
  type Resource,
  type TeacherContributionSink,
  type WorkspaceRequestContext,
} from '@copilot/identity';
import { PgIdentityStore, PgRelationshipStore } from '@copilot/identity/pg';
import {
  EnrollmentService,
  ProgressionEngine,
  SchoolDirectoryService,
} from '@copilot/education-directory';
import { PgEducationStore } from '@copilot/education-directory/pg';
import { PgLedgerStore } from '@copilot/evidence/pg';
import { PgLearningStateStore } from '@copilot/learning-state/pg';
import { snapshotHash } from '@copilot/learning-state';
import {
  UploadIngestionService,
  resolveDocumentVisionAdapter,
  resolveUploadStorageAdapter,
  type DocumentVisionAdapter,
  type ItemCorrection,
  type UploadStorageAdapter,
} from '@copilot/uploads';
import { PgUploadAnalysisStore } from '@copilot/uploads/pg';
import { curriculumLabel, getCurriculumCalendar, loadKnowledgeBase, type KnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { buildDailyPlan, buildExerciseGenerationSpec } from '@copilot/planning';
import { buildAssignmentsForPlan } from '@copilot/practice';
import {
  assertChildSafe,
  buildParentGapDetail,
  buildParentHome,
  buildParentProgress,
  buildParentTeachingPlan,
  buildWeeklyReportView,
} from '@copilot/projections';
import {
  buildRevisionPlan,
  buildWeeklyReport,
  diagnoseAssessment,
  inferExamScope,
  makeNotification,
  resolveNotificationProvider,
  type UserContactLookup,
} from '@copilot/revision';
import { buildLearningTwin } from '@copilot/learning-twin';
import type { AssessmentQuestionOutcome, Exam } from '@copilot/domain';
import { createHash } from 'node:crypto';
import { resolveWorksheetGeneration } from './worksheet-generation.js';
import {
  resolveEffectiveGenerationMode,
  internalLiveBudgetGate,
  listInternalLiveCohort,
  addToInternalLiveCohort,
  removeFromInternalLiveCohort,
  familyRef as familyRefOf,
  resolveKillSwitch,
  setKillSwitch,
  enforceSafetyAutoStop,
  scanInternalLiveSafety,
  purgeInternalLiveForChild,
  isInInternalLiveCohort,
} from './internal-live.js';
import { internalLiveDashboard, reviewQueueOps, listQaSamples, readQaSample, purgeExpiredQaSamples } from './internal-live-observability.js';
import {
  childRefOf,
  pendingLiveWorksheetFor,
  markServed,
  purgeServingForChild,
  purgeStaleServingIntents,
} from './internal-live-serving.js';
import { pilotDashboard } from './internal-live-observability.js';
import {
  pilotChildRef,
  pilotFamilyRef,
  recordPilotConsent as recordPilotConsentRow,
  hasPilotConsent,
  withdrawPilotConsent as withdrawPilotConsentRow,
  familyRequiresConsent,
  addPilotFamily,
  listPilotFamilies,
  recordParentFeedback,
  feedbackRollup,
  recordPilotActivity,
  purgePilotForChild,
  FEEDBACK_VERDICTS,
  type FeedbackVerdict,
} from './pilot.js';
import { insertAiUsageEvent } from './pg-ai-usage.js';
import {
  purgeReviewSnapshots,
  shadowRollup,
  failureBreakdown,
  reviewQueueRollup,
  PgReviewQueueStore,
  REVIEW_QUEUE_STATES,
  type ReviewQueueState,
} from '@copilot/exercise-gen';
import {
  createLogger,
  resolveAnalyticsAdapter,
  type AnalyticsAdapter,
  type Logger,
} from '@copilot/observability';
import {
  applyBillingEvent,
  asChildId,
  entitlementsFor,
  freeSubscription,
  isEntitled,
  PLANS,
  type AnswerSpec,
  type BillingSource,
  type Plan,
  type SubscriptionRecord,
} from '@copilot/domain';
import { resolveReceiptValidationAdapter } from '@copilot/billing';
// Note: @copilot/billing also exports `shouldProcessWebhookEvent` /
// `webhookDedupeKey` (webhook idempotency against `billing_webhook_events`)
// and the raw `AppleReceiptValidationAdapter` / `GooglePlayReceiptValidationAdapter`.
// Not wired here yet: a real store webhook is an UNAUTHENTICATED endpoint
// verified by the store's own signature (Apple JWS / Google Pub/Sub token),
// not a `CallerAuth`-bearer route like everything else in this file — that
// route + signature verification is a real integration task for when a
// store is actually chosen, not scaffolding. `restorePurchase` below (the
// user-initiated, bearer-authenticated "Restore Purchases" flow both stores
// require) is fully wired end-to-end today.
import { createApi, AuthzError, NotFoundError, type RequestContext } from '../api.js';
import { createContextResolver, ForbiddenError, type CallerAuth } from './context.js';
import { resolveChildLearningInputs, syncSchoolGradeCache } from './learning-scene.js';
import { withTransaction } from './transaction.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ProductionApiOptions {
  readonly pool: Pool;
  readonly authAdapter: AuthAdapter;
  readonly knowledgeBase?: KnowledgeBase;
  readonly logger?: Logger;
  readonly now?: () => Date;
  /** Forced OFF in production (fail-closed). Tests set this true. */
  readonly allowTrustedContext?: boolean;
  /** M4 — object store for upload bytes. Default: resolved from env (local-fs / Supabase). */
  readonly uploadStorage?: UploadStorageAdapter;
  /** M4 — document-vision adapter. Default: deterministic mock (no paid call). */
  readonly documentVision?: DocumentVisionAdapter;
  /** M8 (pilot analytics) — Default: resolved from env (Noop unless DZ_ANALYTICS=console). */
  readonly analytics?: AnalyticsAdapter;
  /** Which kind `authAdapter` resolved to — `resolveAuthAdapter`'s own `kind`.
   * Only the 'supabase' branch needs a real password sign-in (see `signIn`
   * below); dev/in-memory keep their existing DB-lookup shortcut. */
  readonly authKind?: 'supabase' | 'dev' | 'in-memory';
  /** doc 66 — inject the worksheet SHADOW generation config (tests / custom
   * deployments). Default: resolved from env (`AI_GENERATION_MODE`), null = OFF. */
  readonly worksheetGeneration?: import('./worksheet-generation.js').ProductionWorksheetGeneration | null;
}

type Queryable = Pool | PoolClient;

/** The full service graph bound to one queryable (a Pool or a transaction client). */
function buildServices(q: Queryable, now: () => Date, logger: Logger) {
  const identityStore = new PgIdentityStore(q);
  const relStore = new PgRelationshipStore(q);
  const eduStore = new PgEducationStore(q);
  const ledger = new PgLedgerStore(q);
  const learningState = new PgLearningStateStore(q);

  const identity = new IdentityService({ store: identityStore, auth: NULL_AUTH, logger, now });
  const family = new FamilyService({ store: identityStore, logger, now });
  const classContext = educationClassContextReader(eduStore);
  const permissions = new PermissionService({ store: relStore, classContext, logger, now });
  const relationships = new RelationshipService({
    store: relStore,
    identityStore,
    permissions,
    logger,
    now,
  });
  const authorization = new AuthorizationService({
    identityStore,
    relationshipStore: relStore,
    permissions,
    now,
  });
  const directory = new SchoolDirectoryService({ store: eduStore, logger, now });
  const enrollments = new EnrollmentService({ store: eduStore, logger, now });
  const progression = new ProgressionEngine({ store: eduStore, enrollments, logger, now });
  const contributionSink: TeacherContributionSink = {
    append: (c: TeacherContribution) => ledger.appendTeacherContribution(c),
  };
  const contributions = new TeacherContributionService({
    permissions,
    sink: contributionSink,
    relationshipStore: relStore,
    logger,
    now,
  });
  const discovery = new DiscoveryService({
    identityStore,
    relationshipStore: relStore,
    educationStore: eduStore,
  });

  return {
    identityStore,
    relStore,
    eduStore,
    ledger,
    learningState,
    identity,
    family,
    permissions,
    relationships,
    authorization,
    directory,
    enrollments,
    progression,
    contributions,
    discovery,
  };
}

// the domain IdentityService needs an AuthAdapter only for register(); the
// production API supplies the real one at the factory level and never calls
// register() from inside a transaction, so a null adapter is safe here.
const NULL_AUTH: AuthAdapter = {
  verifyToken: () => Promise.resolve(null),
  createUser: () => Promise.reject(new Error('register() not available on a scoped service graph')),
};

/**
 * The production API (I7.1). Every Child-data handler:
 *   verified bearer → server-derived identity → workspace → DB-backed resource →
 *   authorize()/can() → domain service → Postgres → workspace-specific DTO.
 *
 * The legacy `createApi` (in-memory `childProfiles`) is NOT used for authorization
 * here — only its already-tested learning-projection pipeline is delegated to,
 * behind a DB authorization check.
 */
export function createProductionApi(opts: ProductionApiOptions) {
  const pool = opts.pool;
  const now = opts.now ?? (() => new Date());
  const logger = opts.logger ?? createLogger({ level: 'warn' });
  const kb = opts.knowledgeBase ?? loadKnowledgeBase();

  const base = buildServices(pool, now, logger);
  // register() needs the real adapter — swap it onto a dedicated IdentityService.
  const registrar = new IdentityService({
    store: base.identityStore,
    auth: opts.authAdapter,
    logger,
    now,
  });
  const deriveContext = createContextResolver({
    identityService: new IdentityService({
      store: base.identityStore,
      auth: opts.authAdapter,
      logger,
      now,
    }),
    allowTrustedContext: opts.allowTrustedContext ?? false,
  });

  // ---- M8: pilot analytics (privacy-safe — @copilot/observability) -----
  const analytics = opts.analytics ?? resolveAnalyticsAdapter(process.env).adapter;
  /** A real userId/childId → an opaque, non-reversible actorRef (sanitizeEvent
   * requires this shape; never log the raw id anywhere analytics can see it). */
  const actorRef = (id: string): string => createHash('sha256').update(id).digest('hex').slice(0, 16);

  // ---- P9: billing readiness (@copilot/billing) ----------------------
  // `resolveReceiptValidationAdapter` is Noop unless DZ_BILLING=mock|live is
  // set — see that module's doc comment. Nothing here can charge anything:
  // `restorePurchase` only reads back a purchase the user already made in
  // the store's own UI, it never creates one.
  const receiptValidation = resolveReceiptValidationAdapter(process.env);

  // ---- P7: notification delivery (@copilot/revision) -----------------
  // `contacts` is the DB-backed UserContactLookup the pure @copilot/revision
  // package can't supply on its own. Real channels only activate once
  // RESEND_API_KEY/NOTIFICATION_FROM_EMAIL (email) or DZ_PUSH_NOTIFICATIONS=1
  // (push) are set — see resolveNotificationProvider's own doc comment.
  const notificationContacts: UserContactLookup = {
    getEmail: async (userId) => {
      const r = (await pool.query(`SELECT notification_email FROM users WHERE id = $1`, [userId]))
        .rows[0] as { notification_email: string | null } | undefined;
      return r?.notification_email ?? null;
    },
    getExpoPushToken: async (userId) => {
      const r = (await pool.query(`SELECT expo_push_token FROM users WHERE id = $1`, [userId]))
        .rows[0] as { expo_push_token: string | null } | undefined;
      return r?.expo_push_token ?? null;
    },
  };
  const notifications = resolveNotificationProvider(process.env, notificationContacts).adapter;

  // ---- M4: upload / document-vision ingestion ----------------------
  const uploadStorage =
    opts.uploadStorage ?? resolveUploadStorageAdapter(process.env).adapter;
  const documentVision =
    opts.documentVision ?? resolveDocumentVisionAdapter(process.env).adapter;
  const uploadStore = new PgUploadAnalysisStore(pool);
  const uploadIngestion = new UploadIngestionService({
    storage: uploadStorage,
    vision: documentVision,
    store: uploadStore,
    now,
    logger,
  });
  const gradeBandSkillIds = (grade: number): string[] =>
    [...kb.skills.entries()]
      .filter(([, s]) => Number((s as { gradeContext?: unknown }).gradeContext) === Number(grade))
      .map(([id]) => String(id));

  /** Every skill this curriculum node introduces — for the teacher curriculum
   * picker (a ticked lesson maps to these `taughtSkillIds`). Built once at
   * startup; the KB is small (~94 skills) but no reason to redo this per call. */
  const skillIdsByCurriculumNode = new Map<string, string[]>();
  for (const [skillId, skill] of kb.skills) {
    const list = skillIdsByCurriculumNode.get(skill.curriculumNodeId) ?? [];
    list.push(String(skillId));
    skillIdsByCurriculumNode.set(skill.curriculumNodeId, list);
  }
  const skillIdsForCurriculumNode = (nodeId: string): string[] => skillIdsByCurriculumNode.get(nodeId) ?? [];

  // ---- helpers -------------------------------------------------------

  async function authorizeChild(
    ctx: WorkspaceRequestContext,
    childId: string,
    action: string,
    subjectId?: string,
  ): Promise<void> {
    const resource: Resource = { kind: 'child', childId, ...(subjectId ? { subjectId } : {}) };
    await base.authorization.authorize(ctx, resource, action);
  }

  /** Delegate a learning-projection call to the tested pipeline, DB-backed + pre-authorized. */
  async function learningScene(childId: string) {
    const inputs = await resolveChildLearningInputs(pool, base.enrollments, childId, now());
    const scoped = createApi({
      // this is the production surface delegating to the tested projection
      // pipeline AFTER a DB authorize() check — not the client-facing legacy path.
      allowLegacyInProduction: true,
      knowledgeBase: kb,
      ledger: base.ledger,
      logger,
      now,
      childProfiles: {
        [childId]: {
          profile: inputs.profile,
          gradeContext: inputs.gradeContext,
          familyUserIds: [], // authorization already happened — this path is not used
          ...(inputs.enrollment ? { enrollment: inputs.enrollment } : {}),
        },
      },
      ...(worksheetGen ? { worksheetGeneration: worksheetGen } : {}),
    });
    return { scoped, inputs };
  }

  const parentDelegateCtx = (userId: string): RequestContext => ({
    userId,
    role: 'admin', // authorization already enforced above; 'admin' bypasses the legacy family check
  });

  /**
   * The SGK chapter/lesson list for a grade — static curriculum content, no
   * child data. Backs the onboarding "con đang học đến bài nào?" picker and the
   * teacher "bài đang dạy" picker. A grade with no seeded calendar returns an
   * empty chapter list (not an error) so a data gap shows as "nothing to pick".
   */
  async function curriculumProgramFor(grade: 4 | 7) {
    const ay = (
      await pool.query(`SELECT label FROM academic_years WHERE status = 'ACTIVE' ORDER BY label DESC LIMIT 1`)
    ).rows[0] as { label: string } | undefined;
    const academicYear = ay?.label ?? '2026-2027';
    const cal = getCurriculumCalendar('KET_NOI_TRI_THUC', grade, academicYear);
    if (!cal) return { curriculum: curriculumLabel('KET_NOI_TRI_THUC'), academicYear, chapters: [] };
    const chapters = [...cal.pacing]
      .sort((a, b) => a.chapter - b.chapter)
      .map((p) => ({
        chapter: p.chapter,
        name: p.name,
        lessons: p.lesson_ids.map((id) => ({
          lessonId: id,
          name: kb.curriculum.get(id)?.lesson ?? id,
          skillIds: skillIdsForCurriculumNode(id),
        })),
      }));
    return { curriculum: curriculumLabel(cal.curriculum), academicYear, chapters };
  }

  // ---- doc 66: production worksheet recovery orchestrator (SHADOW) ----------
  // OFF (default) → null, nothing runs. SHADOW → full run + persist + telemetry,
  // NEVER served to a child. LIVE → still SHADOW-only here (gated).
  const worksheetGen =
    opts.worksheetGeneration !== undefined
      ? opts.worksheetGeneration
      : resolveWorksheetGeneration({
          pool,
          logger,
          planFor: () => 'free', // TODO staging: familySubscription(userId).plan — budget rollup only, never gates routing
          usageSink: (event) => {
            insertAiUsageEvent(pool, event).catch((e) =>
              logger.warn('ai_usage_events insert failed (worksheet)', { error: e instanceof Error ? e.message : String(e) }),
            );
          },
        });

  // ---- doc 69: CONTROLLED INTERNAL LIVE — cohort-gated AI worksheet serving ----

  /** Effective generation mode for the family that owns `ctx.userId`. */
  async function effectiveModeFor(userId: string): Promise<Awaited<ReturnType<typeof resolveEffectiveGenerationMode>>> {
    const famId = await familyIdFor(userId);
    return resolveEffectiveGenerationMode(pool, process.env, famId ? familyRefOf(famId) : null);
  }

  /**
   * If the family is LIVE-eligible (cohort + no kill switch) and within the daily
   * budget, enqueue ONE LIVE worksheet job for today (deterministic spec id → the
   * durable queue dedups to one/child/day). Budget-exhausted → degrade to a
   * SHADOW enqueue (child still gets the legacy worksheet via `childToday`).
   * Non-cohort families are handled by the legacy SHADOW hook (`childToday`).
   */
  async function maybeEnqueueLiveWorksheet(
    userId: string,
    childId: string,
  ): Promise<{ enqueued: boolean; reason: string }> {
    if (!worksheetGen) return { enqueued: false, reason: 'worksheet generation not configured' };
    try {
      const eff = await effectiveModeFor(userId);
      if (eff.mode !== 'LIVE') return { enqueued: false, reason: `effective mode ${eff.mode}: ${eff.reason}` };
      let mode: 'SHADOW' | 'LIVE' = 'LIVE';
      const gate = await internalLiveBudgetGate(pool, process.env, 'generation', 0.05);
      if (!gate.ok) {
        logger.warn('INTERNAL LIVE budget exhausted — degrading to SHADOW', { reason: gate.reason });
        mode = 'SHADOW';
      }
      const cref = childRefOf(childId);
      const day = now().toISOString().slice(0, 10);
      const { scoped, inputs } = await learningScene(childId);
      const s = await scoped._scene(childId);
      // "Hôm nay dạy con gì?" always has an answer: generate for the resolved
      // current lesson / open gaps / active skills even when the deterministic
      // planner returns `no_plan_needed` (mirrors `createPracticeAssignment`'s
      // zero-data fallback). Only skip when there is genuinely nothing to target.
      const hasTarget =
        s.plan.kind === 'plan' ||
        !!s.context.resolved.lessonId ||
        s.gaps.gaps.length > 0 ||
        s.context.resolved.activeSkillIds.length > 0 ||
        s.context.activeSkillIds.length > 0;
      if (!hasTarget) return { enqueued: false, reason: 'no resolved lesson, gap or active skill — nothing to generate' };
      const spec = buildExerciseGenerationSpec({
        childId: asChildId(childId),
        gradeContext: inputs.gradeContext,
        twin: s.twin,
        gaps: s.gaps,
        context: s.context,
        knowledgeBase: kb,
        availableMinutes: 25,
        asOf: s.asOf,
        newId: () => `${mode === 'LIVE' ? 'live' : 'shadow'}-${cref}-${day}`, // pseudonymous + deterministic → one job/child/day/mode
      });
      const q = worksheetGen.queue as {
        enqueue: (m: 'SHADOW' | 'LIVE', j: unknown) => void;
        enqueueDurable?: (rec: { mode: 'SHADOW' | 'LIVE'; spec: unknown; childRef: string; usageContext: unknown }) => Promise<string | null>;
      };
      const rec = {
        mode,
        spec,
        childRef: cref,
        usageContext: { userRef: actorRef(userId), childRef: cref, plan: 'free' as const, learningContextSource: null },
      };
      if (typeof q.enqueueDurable === 'function') {
        // durable queue — AWAIT the persist so a follow-up worker/read sees the job.
        await q.enqueueDurable(rec);
      } else {
        q.enqueue(mode, {
          spec,
          generators: worksheetGen.generators,
          referenceLibrary: worksheetGen.referenceLibrary,
          knowledgeBase: kb,
          ...(worksheetGen.crosscheckAdapter ? { crosscheckAdapter: worksheetGen.crosscheckAdapter } : {}),
          ...(worksheetGen.reviewQueue ? { reviewQueue: worksheetGen.reviewQueue } : {}),
          ...(worksheetGen.store ? { store: worksheetGen.store } : {}),
          ...(worksheetGen.usageSink ? { usageSink: worksheetGen.usageSink } : {}),
          ...(worksheetGen.costGuard ? { costGuard: worksheetGen.costGuard } : {}),
          ...(worksheetGen.perWorksheetCostCeilingUsd ? { config: { costCeilingUsd: worksheetGen.perWorksheetCostCeilingUsd } } : {}),
          usageContext: rec.usageContext,
          childRef: cref,
        });
      }
      return { enqueued: true, reason: `${mode} worksheet enqueued (spec ${spec.generationSpecId})` };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn('LIVE worksheet enqueue failed', { error: reason });
      return { enqueued: false, reason: `enqueue error: ${reason}` };
    }
  }

  /**
   * Turn a completed LIVE worksheet (verified items held in `worksheet_run_serving`)
   * into an `AI_GENERATED` assignment for this authenticated child. Returns the
   * new assignment id, or null when nothing is pending. Only verified items reach
   * the child (enforced again by `servableItemsOf` upstream).
   */
  async function serveLiveWorksheetIfPending(userId: string, childId: string): Promise<string | null> {
    try {
      const pending = await pendingLiveWorksheetFor(pool, childId);
      if (!pending) return null;
      // doc 70 §4 — a pilot family must have recorded guardian consent for the
      // child before any AI-generated content is served. Non-pilot (internal)
      // families are unaffected.
      const famId = await familyIdFor(userId);
      const fref = famId ? familyRefOf(famId) : null;
      if (fref && (await familyRequiresConsent(pool, fref)) && !(await hasPilotConsent(pool, childId))) {
        logger.warn('LIVE worksheet held — pilot child has no guardian consent on file', { family: fref });
        await markServed(pool, pending.runId, { skipReason: 'pilot: no guardian consent' });
        return null;
      }
      const assignmentId = await withTransaction(pool, async (client) => {
        const ls = new PgLearningStateStore(client);
        const row = await ls.createAssignment({
          childId,
          source: 'AI_GENERATED',
          assignedByUserId: userId,
          assignedByRole: 'SYSTEM',
          subjectId: null,
          generationSpecId: null, // the worksheet path mints its own text egs_* id; not the uuid FK
          mode: 'WORKSHEET',
          targetSkillIds: [...new Set(pending.items.map((it) => it.skillId))],
          items: pending.items.map((it) => ({
            orderIndex: it.orderIndex,
            questionRef: it.questionRef,
            skillId: it.skillId,
            problemTypeId: it.problemTypeId,
            knowledgeLevel: it.knowledgeLevel,
            thinkingLevel: it.thinkingLevel,
            prompt: it.prompt,
            answerSpec: it.answerSpec,
            hints: [...it.hints],
          })),
        });
        return row.id;
      });
      await markServed(pool, pending.runId, { assignmentId });
      analytics.track({ category: 'practice', action: 'practice_started', actorRef: actorRef(userId), metadata: { source: 'AI_GENERATED' } });
      if (fref) {
        // best-effort telemetry — never on the serve latency path
        void recordPilotActivity(pool, { familyRef: fref, childRef: childRefOf(childId), actor: 'SYSTEM', event: 'first_worksheet_generated', meta: { runId: pending.runId } });
        void recordPilotActivity(pool, { familyRef: fref, childRef: childRefOf(childId), actor: 'SYSTEM', event: 'practice_started' });
      }
      return assignmentId;
    } catch (err) {
      logger.warn('LIVE worksheet serve failed', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  /** doc 70 §6 — best-effort pilot activity event (pseudonymous). No-op for
   *  a user with no owning family; never blocks the product flow. */
  async function recordPilotActivityFor(
    userId: string,
    childId: string | null,
    actor: 'PARENT' | 'STUDENT' | 'SYSTEM',
    event: import('./pilot.js').PilotEvent,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const famId = await familyIdFor(userId);
      if (!famId) return;
      await recordPilotActivity(pool, {
        familyRef: pilotFamilyRef(famId),
        ...(childId ? { childRef: pilotChildRef(childId) } : {}),
        actor,
        event,
        ...(meta ? { meta } : {}),
      });
    } catch {
      /* telemetry only */
    }
  }

  /** The owning family id for a user (OWNER membership preferred), or undefined. */
  async function familyIdFor(userId: string): Promise<string | undefined> {
    const r = (
      await pool.query(
        `SELECT f.id FROM families f JOIN family_memberships m ON m.family_id = f.id
          WHERE m.user_id = $1 ORDER BY (m.member_role = 'OWNER') DESC LIMIT 1`,
        [userId],
      )
    ).rows[0] as { id: string } | undefined;
    return r?.id;
  }

  /** The full subscription record for a user's family (default free/none). Not
   * gated by `status` here — `isEntitled` decides what "active" means,
   * including 'grace_period' staying entitled (see @copilot/domain). */
  async function familySubscription(userId: string): Promise<SubscriptionRecord> {
    const familyId = await familyIdFor(userId);
    if (!familyId) return freeSubscription(new Date().toISOString());
    const r = (
      await pool.query(
        `SELECT plan, status, source, store_transaction_id, current_period_end,
                grace_period_end, auto_renew, updated_at
           FROM family_subscriptions WHERE family_id = $1`,
        [familyId],
      )
    ).rows[0] as
      | {
          plan: Plan;
          status: SubscriptionRecord['status'];
          source: BillingSource;
          store_transaction_id: string | null;
          current_period_end: Date | null;
          grace_period_end: Date | null;
          auto_renew: boolean;
          updated_at: Date;
        }
      | undefined;
    if (!r) return freeSubscription(new Date().toISOString());
    return {
      plan: r.plan,
      status: r.status,
      source: r.source,
      storeTransactionId: r.store_transaction_id,
      currentPeriodEnd: r.current_period_end?.toISOString() ?? null,
      gracePeriodEnd: r.grace_period_end?.toISOString() ?? null,
      autoRenew: r.auto_renew,
      updatedAt: r.updated_at.toISOString(),
    };
  }

  /** The EFFECTIVE plan for the family this user owns or belongs to — 'free'
   * whenever the subscription isn't currently entitled (expired/past_due/no
   * subscription), even if a stale non-free `plan` value is still on the row. */
  async function familyPlan(userId: string): Promise<Plan> {
    const sub = await familySubscription(userId);
    const now = new Date().toISOString();
    return isEntitled(sub, now) ? sub.plan : 'free';
  }

  // ---- IX: recompute-if-stale persisted learning state --------------
  //
  // The Twin / gaps / plan are DERIVED from the append-only `evidence` stream.
  // Every learning read runs the tested pipeline once, then — only when the
  // persisted derived rows are STALE (evidence count or version moved) —
  // re-persists skill_states / knowledge_gaps / learning_plans / snapshots so
  // `child_id` owns durable, version+hash-guarded learning state. `submitPractice`
  // and `confirmUploadAnalysis` call `invalidateDerived`, which forces the next
  // read to recompute.
  const TWIN_STATE_VERSION = 'twin.v2';
  const GAPS_STATE_VERSION = 'gaps.v2';
  const CONTEXT_STATE_VERSION = 'context.v2';

  /** The most recent Monday on/before `d`, as YYYY-MM-DD (UTC) — the weekly
   * report's `weekOf` boundary. */
  function mostRecentMonday(d: Date): string {
    const dayOfWeek = d.getUTCDay(); // 0=Sun..6=Sat
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(d.getTime() - daysSinceMonday * 86_400_000);
    return monday.toISOString().slice(0, 10);
  }

  function twinBlob(twin: import('@copilot/domain').ChildLearningTwin) {
    return {
      skillMastery: Object.fromEntries(
        [...twin.skillMastery.entries()].map(([k, v]) => [String(k), v.mastery]),
      ),
      thinking: Object.fromEntries(
        [...twin.thinkingProfile.entries()].map(([k, v]) => [String(k), v.demonstratedLevel]),
      ),
    };
  }

  async function refreshLearningState(childId: string) {
    const { scoped } = await learningScene(childId);
    const s = await scoped._scene(childId);
    const evidenceCount = (await base.ledger.listEvidence(asChildId(childId))).length;

    const twinSnap = await base.learningState.getSnapshot(childId, 'TWIN');
    const fresh =
      twinSnap?.stateVersion === TWIN_STATE_VERSION && twinSnap.evidenceCount === evidenceCount;

    if (!fresh) {
      // For gap_detected/gap_improved analytics — the GAPS snapshot BEFORE this
      // recompute overwrites it, so a real state transition can be told apart
      // from "still the same gap, just recomputed".
      const prevGapsSnap = await base.learningState.getSnapshot(childId, 'GAPS');
      const prevGapsById = new Map(
        ((prevGapsSnap?.state as { id: string; lifecycleState: string }[] | undefined) ?? []).map(
          (g) => [g.id, g.lifecycleState],
        ),
      );
      // The persisted snapshots/skill-states/gaps/plan are a CACHE. The scene
      // `s` above is always freshly computed and correct. Several child screens
      // (today / progress / review) fire near-simultaneously and each calls
      // this; right after new evidence they all see `!fresh` and race to write
      // → a unique-violation on the loser. That's harmless: swallow it and
      // return the computed scene. The winner populates the cache.
      try {
      const at = now().toISOString();
      const blob = twinBlob(s.twin);
      await base.learningState.putSnapshot({
        childId,
        kind: 'TWIN',
        state: blob,
        stateVersion: TWIN_STATE_VERSION,
        evidenceCount,
        contentHash: snapshotHash(blob),
        provenance: { computedBy: 'refreshLearningState' },
        computedAt: at,
      });
      const gapBlob = s.gaps.gaps.map((g) => ({
        id: g.id,
        type: g.type,
        targetSkillId: g.targetSkillId,
        lifecycleState: g.lifecycleState,
        priority: g.score.score,
      }));
      await base.learningState.putSnapshot({
        childId,
        kind: 'GAPS',
        state: gapBlob,
        stateVersion: GAPS_STATE_VERSION,
        evidenceCount,
        contentHash: snapshotHash(gapBlob),
        provenance: { computedBy: 'refreshLearningState' },
        computedAt: at,
      });
      {
        const IMPROVED_STATES = new Set(['IMPROVING', 'CLOSED', 'MONITORING']);
        let newlyDetected = 0;
        let newlyImproved = 0;
        for (const g of s.gaps.gaps) {
          const prevState = prevGapsById.get(g.id);
          if (prevState === undefined) newlyDetected += 1;
          else if (!IMPROVED_STATES.has(prevState) && IMPROVED_STATES.has(g.lifecycleState)) newlyImproved += 1;
        }
        if (newlyDetected > 0) {
          analytics.track({ category: 'child', action: 'gap_detected', actorRef: actorRef(childId), metadata: { count: newlyDetected } });
        }
        if (newlyImproved > 0) {
          analytics.track({ category: 'child', action: 'gap_improved', actorRef: actorRef(childId), metadata: { count: newlyImproved } });
        }
      }
      const ctxBlob = {
        resolvedLessonId: s.context.resolved.lessonId,
        source: s.context.resolved.source,
        confidence: s.context.resolved.confidence,
      };
      await base.learningState.putSnapshot({
        childId,
        kind: 'CONTEXT',
        state: ctxBlob,
        stateVersion: CONTEXT_STATE_VERSION,
        evidenceCount,
        contentHash: snapshotHash(ctxBlob),
        provenance: { computedBy: 'refreshLearningState' },
        computedAt: at,
      });

      await base.learningState.replaceSkillStates(
        childId,
        [...s.twin.skillMastery.entries()].map(([skillId, m]) => ({
          childId,
          skillId: String(skillId),
          mastery: m.mastery,
          confidence: m.confidence,
          retention: m.retention ?? null,
          evidenceCount: m.evidenceCount,
          lastObservedAt: m.lastObservedAt ?? null,
          lastVerifiedAt: m.lastVerifiedAt ?? null,
          computedFromEvidenceCount: evidenceCount,
          computedAt: at,
        })),
      );
      await base.learningState.replaceGaps(
        childId,
        s.gaps.gaps.map((g) => ({
          id: cryptoRandom(), // storage id; the engine's ephemeral g.id lives only in the GAPS snapshot
          childId,
          gapType: g.type,
          targetSkillId: String(g.targetSkillId),
          rootSkillId: g.rootSkillId ? String(g.rootSkillId) : null,
          severity: g.severity,
          priority: g.score.score,
          lifecycleState: g.lifecycleState,
          blocksCurrentLearning: g.blocksCurrentLearning,
          blocksAdvancedLearning: g.blocksAdvancedLearning,
          rationale: g.rationale ?? null,
          evidenceRefs: [...g.evidenceRefs],
          detectedAt: g.detectedAt,
          updatedAt: at,
          computedFromEvidenceCount: evidenceCount,
        })),
      );
      if (s.plan.kind === 'plan') {
        analytics.track({
          category: 'plan',
          action: 'plan_created',
          actorRef: actorRef(childId),
          metadata: { availableMinutes: s.plan.availableMinutes },
        });
        await base.learningState
          .savePlan({
            id: cryptoRandom(),
            childId,
            planDate: s.plan.planDate,
            availableMinutes: 25,
            kind: 'plan',
            mix: (s.plan.mix as Record<string, number>) ?? {},
            plannerVersion: 'exercise-spec.v1',
            createdAt: at,
            items: s.plan.orderedActions.map((a, i) => ({
              orderIndex: i,
              actionKind: String((a as { kind?: unknown }).kind ?? 'school'),
              skillId: ((a as { targetSkillId?: string }).targetSkillId as string | undefined) ?? null,
              minutes: Number((a as { minutes?: unknown }).minutes ?? 0),
              payload: {},
            })),
          })
          .catch(() => undefined);
      }
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code !== '23505') throw e; // only a concurrent-refresh race is expected
        logger?.debug?.('refreshLearningState: cache write lost a race', { childId });
      }
    }

    return {
      twin: s.twin,
      gaps: s.gaps,
      context: s.context,
      plan: s.plan,
      profile: s.rec.profile,
      gradeContext: s.rec.gradeContext,
      fromCache: fresh,
    };
  }
  const projInput = (s: Awaited<ReturnType<typeof refreshLearningState>>) => ({
    profile: s.profile,
    twin: s.twin,
    gaps: s.gaps,
    context: s.context,
    plan: s.plan,
    knowledgeBase: kb,
  });

  // ---- DTO mappers (data minimization — §11) ------------------------

  const meDto = (r: Awaited<ReturnType<typeof registrar.getIdentity>>) => ({
    userId: r.user.id,
    displayName: r.user.displayName,
    locale: r.user.locale,
    roles: r.roles,
    profiles: {
      parent: r.parentProfile ? { displayName: r.parentProfile.displayName } : null,
      teacher: r.teacherProfile
        ? {
            displayName: r.teacherProfile.displayName,
            verificationStatus: r.teacherProfile.verificationStatus,
          }
        : null,
    },
  });

  const childDto = (row: any) => ({
    childId: row.id,
    displayName: row.display_name,
    schoolGrade: row.school_grade,
    dateOfBirth: row.date_of_birth ? String(row.date_of_birth).slice(0, 10) : null,
  });

  const requestDto = (r: any) => ({
    id: r.id,
    relationshipKind: r.relationshipKind,
    relationshipType: r.relationshipType,
    requesterRole: r.requesterRole,
    targetType: r.targetType,
    targetChildId: r.targetChildId,
    subjectId: r.subjectId,
    proposedPermissions: r.proposedPermissions,
    status: r.status,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  });

  const linkDto = (l: any) => ({
    id: l.id,
    teacherUserId: l.teacherUserId,
    subjectId: l.subjectId,
    relationshipType: l.relationshipType,
    accessSource: l.accessSource,
    status: l.status,
    needsGuardianReview: l.needsGuardianReview,
    acceptedAt: l.acceptedAt,
  });

  const uploadAnalysisDto = (
    a: import('@copilot/domain').UploadAnalysisRecord,
    knowledge?: KnowledgeBase,
  ) => {
    const skillName = (id: string) => knowledge?.skills.get(id as never)?.name ?? id;
    const AUTOSELECT = 0.6;
    return {
      uploadId: a.uploadId,
      state: a.state,
      confidence: a.confidence,
      adapterProvider: a.adapterProvider,
      extractionVersion: a.extractionVersion,
      errorCode: a.errorCode,
      errorMessage: a.errorMessage,
      confirmedAt: a.confirmedAt,
      evidenceRecorded: a.resultingEvidenceIds.length,
      documentType: a.extraction?.documentType ?? null,
      observedOn: a.extraction?.observedOn ?? null,
      teacherNote: a.extraction?.teacherNote ?? null,
      items: (a.extraction?.items ?? []).map((it) => ({
        index: it.index,
        prompt: it.prompt,
        childAnswer: it.childAnswer,
        markedCorrect: it.markedCorrect,
        autoSelected: (it.skillCandidates[0]?.confidence ?? 0) >= AUTOSELECT,
        skillCandidates: it.skillCandidates.map((c) => ({
          skillId: c.skillId,
          skillName: skillName(c.skillId),
          confidence: c.confidence,
        })),
      })),
    };
  };

  const LOST_POINT_LABEL: Record<string, string> = {
    careless_error: 'Bất cẩn',
    concept_gap: 'Hổng kiến thức',
    prerequisite_gap: 'Hổng kiến thức nền',
    method_gap: 'Sai phương pháp',
    procedural_gap: 'Sai khâu thực hiện',
    recognition_gap: 'Không nhận ra dạng',
    reasoning_gap: 'Lập luận',
    application_gap: 'Vận dụng',
    presentation_error: 'Trình bày',
    reading_error: 'Đọc đề',
    retention_gap: 'Đã quên',
  };

  const this_examDiagnosisDto = (d: import('@copilot/domain').AssessmentDiagnosis) => {
    const byCategory = new Map<string, number>();
    for (const lp of d.lostPoints) {
      byCategory.set(lp.classification, (byCategory.get(lp.classification) ?? 0) + lp.lostFraction);
    }
    return {
      examId: d.examId,
      totalAwardedPercent: Math.round(d.totalAwarded * 100),
      lostPoints: d.lostPoints.map((lp) => ({
        questionRef: lp.questionRef,
        skillId: lp.skillId,
        skillName: kb.skills.get(lp.skillId)?.name ?? lp.skillId,
        lostFraction: lp.lostFraction,
        category: lp.classification,
        categoryLabel: LOST_POINT_LABEL[lp.classification] ?? lp.classification,
        note: lp.note,
      })),
      byCategory: [...byCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([c, loss]) => ({
          category: c,
          categoryLabel: LOST_POINT_LABEL[c] ?? c,
          lostPoints: Number(loss.toFixed(2)),
        })),
      remediation: d.remediationSkillIds
        .slice(0, 6)
        .map((id) => ({ skillId: id, name: kb.skills.get(id)?.name ?? id })),
    };
  };

  // ---- IDENTITY / WORKSPACE ---------------------------------------

  return {
    /** POST /auth/register — provider createUser + users row + role + profile. */
    async register(input: {
      email?: string;
      phone?: string;
      password: string;
      intendedRole: 'PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN';
      displayName?: string;
    }) {
      const r = await registrar.register(input);
      analytics.track({ category: 'auth', action: 'signup', actorRef: actorRef(r.user.id), metadata: { role: input.intendedRole } });
      // Same email the user already gave to sign up — not a new collection.
      // Kept separate from the auth provider's own copy (data minimization;
      // see the notification_email migration's doc comment).
      if (input.email) {
        await pool.query(`UPDATE users SET notification_email = $1 WHERE id = $2`, [input.email, r.user.id]);
      }
      return meDto(r);
    },

    /**
     * POST /auth/login — mint a real, USABLE bearer for an existing account.
     * Replaces the old `bearerForUser` shortcut (apps/web/lib/server/rest.ts)
     * that read `users.auth_user_id` and handed it back AS the bearer — which
     * only ever worked because Dev/InMemoryAuthAdapter's `verifyToken` treats
     * "the token IS the id" as valid. Confirmed live (2026-09-05) that this
     * breaks silently under real Supabase Auth: `createUser` (an ADMIN
     * operation) returns the Supabase user's raw id, not a signed session —
     * handing that back as "bearer" produced a 200 response that then failed
     * every subsequent authenticated call with no error, just `null`.
     *
     * `authKind !== 'supabase'` keeps the EXACT old DB-lookup behavior
     * (zero behavior change for dev/in-memory pilot testing, which never
     * required a real password). `authKind === 'supabase'` calls GoTrue's
     * real password grant — `password` is required in that branch.
     */
    async signIn(input: { email?: string; phone?: string; password?: string }) {
      const email = input.email?.trim().toLowerCase();
      if (!email && !input.phone) throw new ForbiddenError('email hoặc số điện thoại là bắt buộc');
      const row = (
        await pool.query(
          email
            ? `SELECT id, auth_user_id FROM users WHERE lower(primary_email) = $1`
            : `SELECT id, auth_user_id FROM users WHERE primary_phone = $1`,
          [email ?? input.phone],
        )
      ).rows[0] as { id: string; auth_user_id: string | null } | undefined;
      if (!row) throw new NotFoundError('Không tìm thấy tài khoản với thông tin này.');

      if (opts.authKind === 'supabase') {
        if (!input.password) throw new ForbiddenError('Vui lòng nhập mật khẩu để đăng nhập.');
        if (!(opts.authAdapter instanceof SupabaseAuthAdapter)) {
          throw new Error('authKind is supabase but authAdapter is not a SupabaseAuthAdapter');
        }
        let bearer: string;
        try {
          bearer = await opts.authAdapter.signInWithPassword({
            ...(email ? { email } : {}),
            ...(input.phone ? { phone: input.phone } : {}),
            password: input.password,
          });
        } catch (e) {
          // Never let GoTrue's raw HTTP error text reach the client (confirmed
          // live 2026-09-05: it read "Supabase sign-in failed: 400
          // {...invalid_credentials...}" — technically accurate, meaningless
          // to a parent typing their password on a phone). Map the one case
          // that matters (wrong email/password) to a clear Vietnamese message;
          // anything else (network blip, Supabase outage) to a generic retry
          // line, still without leaking provider internals.
          const msg = e instanceof Error ? e.message : String(e);
          if (/invalid_credentials|invalid login credentials/i.test(msg)) {
            throw new ForbiddenError('Sai email hoặc mật khẩu. Vui lòng kiểm tra lại.');
          }
          throw new ForbiddenError('Không thể đăng nhập lúc này. Vui lòng thử lại sau.');
        }
        return { bearer };
      }

      // dev / in-memory — unchanged shortcut: the stored auth_user_id IS a
      // valid bearer for those adapters (verifyToken treats token === id).
      if (!row.auth_user_id) throw new Error('no auth token for this user (real IdP required)');
      return { bearer: row.auth_user_id };
    },

    /**
     * POST /me/push-token — a device registers its Expo push token after the
     * user grants OS notification permission. Same flow as the Tuzi
     * project's `registerForPush()`. No-op-safe: push notifications stay
     * inert (DZ_PUSH_NOTIFICATIONS unset) even once tokens exist.
     */
    async registerPushToken(auth: CallerAuth, expoPushToken: string) {
      const ctx = await deriveContext(auth);
      const token = expoPushToken.trim();
      if (!token) throw new ForbiddenError('expoPushToken trống');
      await pool.query(`UPDATE users SET expo_push_token = $1 WHERE id = $2`, [token, ctx.userId]);
      return { ok: true as const };
    },

    /** GET /me */
    /** Authenticate a bearer with NO workspace requirement (for the app shell). */
    async whoami(bearer: string) {
      const resolved = await registrar.authenticate(bearer);
      if (!resolved) return null;
      return {
        userId: resolved.user.id,
        displayName: resolved.user.displayName,
        roles: resolved.roles,
      };
    },

    async getMe(auth: CallerAuth) {
      const ctx = await deriveContext(auth);
      return meDto(await registrar.getIdentity(ctx.userId as never));
    },

    /** GET /me/roles */
    async getMeRoles(auth: CallerAuth) {
      const ctx = await deriveContext(auth);
      const r = await registrar.getIdentity(ctx.userId as never);
      return {
        userId: r.user.id,
        roles: r.roles,
        defaultWorkspace: r.roles.includes('PARENT') ? 'PARENT' : (r.roles[0] ?? null),
      };
    },

    /** POST /me/switch-workspace — returns the server-derived context (never client-asserted). */
    async switchWorkspace(bearer: string, workspace: 'PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN') {
      const ctx = await deriveContext({ bearer, workspace });
      return {
        userId: ctx.userId,
        workspace: ctx.workspace,
        ...(ctx.childScope !== undefined ? { childScope: ctx.childScope } : {}),
      };
    },

    // ---- PARENT / CHILD -------------------------------------------

    /** GET /children — guardian rows for the caller. */
    async listChildren(auth: CallerAuth) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      const rows = (
        await pool.query(
          `SELECT c.id, c.display_name, c.school_grade, c.date_of_birth
             FROM parent_child_relationships r
             JOIN child_profiles c ON c.id = r.child_id
            WHERE r.parent_user_id = $1 AND r.status = 'ACTIVE' AND c.deletion_state <> 'deleted'
            ORDER BY c.created_at`,
          [ctx.userId],
        )
      ).rows;
      return rows.map(childDto);
    },

    /** POST /children — creates the child + the creator as first guardian. */
    async createChild(
      auth: CallerAuth,
      input: { displayName: string; schoolGrade: number; dateOfBirth?: string },
    ) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      // entitlement gate — feature/quota only, never touches AI routing
      const plan = await familyPlan(ctx.userId);
      const current = (
        await pool.query(
          `SELECT count(*)::int n FROM parent_child_relationships r
             JOIN child_profiles c ON c.id = r.child_id
            WHERE r.parent_user_id = $1 AND r.status = 'ACTIVE' AND c.deletion_state <> 'deleted'`,
          [ctx.userId],
        )
      ).rows[0] as { n: number };
      if (current.n >= entitlementsFor(plan).maxChildren) {
        throw new ForbiddenError(
          `gói ${plan} cho tối đa ${entitlementsFor(plan).maxChildren} hồ sơ con — nâng gói để thêm`,
        );
      }
      return withTransaction(pool, async (client) => {
        const svc = buildServices(client, now, logger);
        // find or create a billing family owned by this parent
        const fam = (
          await client.query(
            `SELECT f.id FROM families f
               JOIN family_memberships m ON m.family_id = f.id
              WHERE m.user_id = $1 AND m.member_role = 'OWNER' LIMIT 1`,
            [ctx.userId],
          )
        ).rows[0] as any;
        const familyId = fam?.id ?? (await svc.family.createFamily(ctx.userId as never));
        const childId = await svc.family.createChild({
          familyId: familyId as never,
          creatorUserId: ctx.userId as never,
          displayName: input.displayName,
          schoolGrade: input.schoolGrade,
          ...(input.dateOfBirth ? { dateOfBirth: input.dateOfBirth } : {}),
        });
        const row = (await client.query(`SELECT * FROM child_profiles WHERE id = $1`, [childId]))
          .rows[0];
        analytics.track({ category: 'child', action: 'child_created', actorRef: actorRef(ctx.userId), metadata: { grade: input.schoolGrade } });
        void recordPilotActivityFor(ctx.userId, childId as string, 'PARENT', 'profile_created', { grade: input.schoolGrade });
        return childDto(row);
      });
    },

    /** GET /children/:childId */
    async getChild(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      await authorizeChild(ctx, childId, 'view_child');
      const row = (
        await pool.query(
          `SELECT * FROM child_profiles WHERE id = $1 AND deletion_state <> 'deleted'`,
          [childId],
        )
      ).rows[0];
      if (!row) throw new NotFoundError(`unknown child ${childId}`);
      if (ctx.workspace === 'TEACHER') {
        // teacher sees display name + granted fields only
        return { childId: row.id, displayName: row.display_name };
      }
      return childDto(row);
    },

    /** GET /children/:childId/guardians */
    async listGuardians(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      await authorizeChild(ctx, childId, 'view_child');
      const rows = (
        await pool.query(
          `SELECT parent_user_id, relationship_type, authority_source, can_manage_child,
                  can_manage_privacy, can_approve_teacher_relationships, status
             FROM parent_child_relationships WHERE child_id = $1 ORDER BY created_at`,
          [childId],
        )
      ).rows;
      return rows.map((r: any) => ({
        parentUserId: r.parent_user_id,
        relationshipType: r.relationship_type,
        authoritySource: r.authority_source,
        capabilities: {
          canManageChild: r.can_manage_child,
          canManagePrivacy: r.can_manage_privacy,
          canApproveTeacherRelationships: r.can_approve_teacher_relationships,
        },
        status: r.status,
      }));
    },

    // ---- ENROLLMENT --------------------------------------------

    /** GET /children/:childId/enrollments — full history, never overwritten. */
    async listEnrollments(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      await authorizeChild(ctx, childId, 'view_child');
      const [school, cls, transitions] = await Promise.all([
        base.enrollments.listSchoolEnrollments(childId),
        base.enrollments.listClassEnrollments(childId),
        base.progression.listTransitions(childId),
      ]);
      const schoolNamed = await Promise.all(
        school.map(async (s) => ({
          ...s,
          schoolName: s.schoolId
            ? ((await base.directory.getSchool(String(s.schoolId)).catch(() => null))?.officialName ?? null)
            : null,
        })),
      );
      const clsNamed = await Promise.all(
        cls.map(async (c) => {
          const room = c.classroomId
            ? await base.directory.getClassroom(String(c.classroomId)).catch(() => null)
            : null;
          return { ...c, className: room?.displayName ?? room?.className ?? null };
        }),
      );
      return { school: schoolNamed, class: clsNamed, transitions };
    },

    /** POST /children/:childId/enrollments/school */
    async createSchoolEnrollment(
      auth: CallerAuth,
      childId: string,
      input: { schoolId: string; academicYearId: string; grade: number; calendarId?: string },
    ) {
      const ctx = await deriveContext(auth);
      await authorizeChild(ctx, childId, 'manage_child');
      const rec = await withTransaction(pool, async (client) => {
        const svc = buildServices(client, now, logger);
        const r = await svc.enrollments.createSchoolEnrollment({ childId, ...input });
        return r;
      });
      await syncSchoolGradeCache(pool, base.enrollments, childId, now());
      return rec;
    },

    /** POST /children/:childId/enrollments/class */
    async createClassEnrollment(
      auth: CallerAuth,
      childId: string,
      input: {
        classroomId: string;
        academicYearId: string;
        enrollmentType?:
          | 'PRIMARY'
          | 'SUPPLEMENTARY'
          | 'HSG_TEAM'
          | 'TUTOR_GROUP'
          | 'CLUB'
          | 'OTHER';
        privacyMode?: 'PRIVATE_LEARNING' | 'LINKED_PRIVATE' | 'LINKED_SHARED';
        schoolEnrollmentId?: string;
      },
    ) {
      const ctx = await deriveContext(auth);
      await authorizeChild(ctx, childId, 'manage_child');
      return withTransaction(pool, async (client) => {
        const svc = buildServices(client, now, logger);
        return svc.enrollments.createClassEnrollment({ childId, ...input });
      });
    },

    /** PATCH /children/:childId/class-enrollments/:id/privacy */
    async setClassPrivacy(
      auth: CallerAuth,
      childId: string,
      classEnrollmentId: string,
      privacyMode: 'PRIVATE_LEARNING' | 'LINKED_PRIVATE' | 'LINKED_SHARED',
    ) {
      const ctx = await deriveContext(auth);
      await authorizeChild(ctx, childId, 'set_privacy_mode');
      return withTransaction(pool, async (client) => {
        const svc = buildServices(client, now, logger);
        const enr = await svc.eduStore.getClassEnrollment(classEnrollmentId);
        if (!enr || enr.childId !== childId) throw new NotFoundError('class enrollment');
        const wasShared = enr.privacyMode === 'LINKED_SHARED';
        const updated = await svc.enrollments.setClassPrivacyMode(classEnrollmentId, privacyMode);
        // downgrading LINKED_SHARED → revoke now-out-of-scope class-derived grants
        if (wasShared && privacyMode !== 'LINKED_SHARED') {
          const links = await svc.relStore.listTeacherChildLinks({ childId });
          for (const l of links) {
            if (l.status === 'ACCEPTED') {
              await svc.permissions.revokeGrantsForLink(l.id, 'CLASS_ASSIGNMENT');
            }
          }
        }
        await svc.relStore.appendAuditEvent({
          id: cryptoRandom(),
          actorUserId: ctx.userId,
          actorWorkspace: ctx.workspace,
          eventType: 'PRIVACY_MODE_CHANGED',
          subjectType: 'student_class_enrollments',
          subjectId: classEnrollmentId,
          childId,
          payload: { from: enr.privacyMode, to: privacyMode },
          createdAt: now().toISOString(),
        });
        return updated;
      });
    },

    // ---- LEARNING (DB-authorized, tested pipeline) -----------

    /** GET /children/:childId/learning-context */
    async getLearningContext(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      await authorizeChild(ctx, childId, 'view_learning_context');
      const { scoped } = await learningScene(childId);
      return scoped.learningContext(parentDelegateCtx(ctx.userId), childId);
    },

    /** GET /children/:childId/today (PARENT preview) / see student route for the child view. */
    async getToday(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace === 'STUDENT') {
        if (ctx.childScope !== childId) throw new ForbiddenError('student token is scoped to another child');
        await serveLiveWorksheetIfPending(ctx.userId, childId); // doc 69 §5 — pick up a ready LIVE worksheet
        const { scoped } = await learningScene(childId);
        return scoped.childToday({ userId: ctx.userId, role: 'child', childScope: childId }, childId);
      }
      await authorizeChild(ctx, childId, 'view_child');
      void recordPilotActivityFor(ctx.userId, childId, 'PARENT', 'today_viewed');
      // doc 69 §5 — a LIVE-cohort family: serve a ready worksheet, else queue
      // today's (deterministic spec + one INSERT — fast, errors swallowed).
      const served = await serveLiveWorksheetIfPending(ctx.userId, childId);
      if (!served) await maybeEnqueueLiveWorksheet(ctx.userId, childId);
      const { scoped } = await learningScene(childId);
      return scoped.childToday({ userId: 'preview', role: 'child', childScope: childId }, childId);
    },

    /**
     * GET /children/:childId/home — the hero screen ("Hôm nay dạy con gì?").
     * DB-authorized → recompute-if-stale learning state → tested Parent projection.
     */
    async getParentHome(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const s = await refreshLearningState(childId);
      analytics.track({ category: 'navigation', action: 'parent_home_viewed', actorRef: actorRef(ctx.userId) });
      return buildParentHome(projInput(s));
    },

    /** GET /children/:childId/progress */
    async getParentProgress(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const s = await refreshLearningState(childId);
      const all = await base.ledger.listEvidence(asChildId(childId));
      const recentEvidence = all.slice(-40); // listEvidence is occurredAt/recordedAt ASC
      return buildParentProgress({ ...projInput(s), recentEvidence });
    },

    /**
     * GET /children/:childId/weekly-report (Blueprint §10, P14) — buildWeeklyReport
     * has existed, fully tested, since Phase 9 but was never wired to any app.
     * The blocker was `twinBefore`: the Twin as it stood a week ago. That's a
     * real point-in-time reconstruction, not an approximation — buildLearningTwin
     * is pure over an explicit evidence array + `asOf`
     * (packages/learning-twin/src/twin.ts), so "before" is the same tested
     * function run over evidence recorded at/before the cutoff, exactly like
     * "after" runs it (via refreshLearningState) over the full stream. Never
     * persisted — this is a read-only report, not a new cache entry.
     */
    async getWeeklyReport(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');

      const s = await refreshLearningState(childId);
      const allEvidence = await base.ledger.listEvidence(asChildId(childId)); // ASC by occurredAt

      const cutoff = new Date(now().getTime() - 7 * 86_400_000);
      const cutoffIso = cutoff.toISOString();
      const beforeEvidence = allEvidence.filter((e) => e.occurredAt <= cutoffIso);
      const weekEvidence = allEvidence.filter((e) => e.occurredAt > cutoffIso);

      const twinBefore = buildLearningTwin({
        childId: asChildId(childId),
        gradeContext: s.gradeContext,
        evidence: beforeEvidence,
        knowledgeBase: kb,
        asOf: cutoff,
      });

      const report = buildWeeklyReport({
        childId: asChildId(childId),
        weekOf: mostRecentMonday(cutoff),
        weekEvidence,
        twinBefore,
        twinAfter: s.twin,
        gapsAfter: s.gaps,
        knowledgeBase: kb,
      });
      return buildWeeklyReportView(report);
    },

    /** GET /children/:childId/gaps/:gapId */
    async getParentGapDetail(auth: CallerAuth, childId: string, gapId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const s = await refreshLearningState(childId);
      const view = buildParentGapDetail(projInput(s), gapId);
      if (!view) throw new NotFoundError('gap');
      return view;
    },

    /** GET /children/:childId/teaching-plan — Parent Teaching Copilot (M5). */
    async getParentTeachingPlan(auth: CallerAuth, childId: string, gapId?: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const s = await refreshLearningState(childId);
      const view = buildParentTeachingPlan(projInput(s), gapId);
      if (!view) throw new NotFoundError('teaching plan');
      analytics.track({ category: 'teaching_copilot', action: 'teaching_copilot_opened', actorRef: actorRef(ctx.userId) });
      return view;
    },

    // ---- M6: EXAM INTELLIGENCE --------------------------------------

    async listExams(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const rows = (
        await pool.query(
          `SELECT e.id, e.exam_date::text AS exam_date, e.subject, e.notes, e.status,
                  e.scope_skill_ids, (r.id IS NOT NULL) AS has_result
             FROM exams e LEFT JOIN exam_results r ON r.exam_id = e.id
            WHERE e.child_id = $1 ORDER BY e.exam_date DESC`,
          [childId],
        )
      ).rows as any[];
      return rows.map((x) => ({
        id: x.id,
        examDate: String(x.exam_date).slice(0, 10),
        subject: x.subject,
        notes: x.notes ?? null,
        status: x.status,
        hasResult: x.has_result,
        scopeConfirmed: Array.isArray(x.scope_skill_ids),
      }));
    },

    /** POST /children/:childId/exams — create + infer scope from recent context. */
    async createExam(
      auth: CallerAuth,
      childId: string,
      input: { examDate: string; subject: string; notes?: string; scopeSkillIds?: readonly string[] },
    ) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'manage_child');
      const s = await refreshLearningState(childId);
      const inferred = inferExamScope(s.context, s.twin, kb);
      const id = cryptoRandom();
      await pool.query(
        `INSERT INTO exams (id, child_id, exam_date, subject, notes, scope_skill_ids, inferred_scope, status, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
        [
          id,
          childId,
          input.examDate,
          input.subject,
          input.notes ?? null,
          input.scopeSkillIds ? JSON.stringify(input.scopeSkillIds) : null,
          JSON.stringify(inferred),
          input.scopeSkillIds ? 'SCOPE_CONFIRMED' : 'SCHEDULED',
          ctx.userId,
        ],
      );
      return { examId: id, inferredScope: inferred };
    },

    /** PATCH /exams/:examId/scope — parent confirms / edits the scope. */
    async confirmExamScope(auth: CallerAuth, childId: string, examId: string, skillIds: readonly string[]) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'manage_child');
      const r = await pool.query(
        `UPDATE exams SET scope_skill_ids = $1::jsonb, status = 'SCOPE_CONFIRMED', updated_at = now()
          WHERE id = $2 AND child_id = $3 RETURNING id`,
        [JSON.stringify(skillIds), examId, childId],
      );
      if (!r.rows[0]) throw new NotFoundError('exam');
      return { ok: true };
    },

    /** GET /exams/:examId/revision-map — deterministic, recomputed on read. */
    async getRevisionMap(auth: CallerAuth, childId: string, examId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const row = (
        await pool.query(
          `SELECT id, exam_date::text AS exam_date, subject, scope_skill_ids, inferred_scope
             FROM exams WHERE id = $1 AND child_id = $2`,
          [examId, childId],
        )
      ).rows[0] as any;
      if (!row) throw new NotFoundError('exam');
      const s = await refreshLearningState(childId);
      const exam: Exam = {
        id: row.id,
        childId: asChildId(childId),
        examDate: String(row.exam_date).slice(0, 10),
        subject: row.subject,
        ...(Array.isArray(row.scope_skill_ids)
          ? { scopeSkillIds: row.scope_skill_ids as never }
          : {}),
        ...(row.inferred_scope ? { inferredScope: row.inferred_scope } : {}),
      };
      const plan = buildRevisionPlan({
        childId: asChildId(childId),
        exam,
        twin: s.twin,
        gaps: s.gaps,
        knowledgeBase: kb,
        asOf: now(),
      });
      return {
        examId,
        subject: row.subject,
        examDate: exam.examDate,
        dayCountdown: plan.dayCountdown,
        dailyMinutes: plan.dailyMinutes,
        scopeConfirmed: Array.isArray(row.scope_skill_ids),
        needsScopeConfirm: !Array.isArray(row.scope_skill_ids) && (row.inferred_scope?.needsParentConfirm ?? true),
        items: plan.priorityItems.map((it) => ({
          skillId: it.skillId,
          name: it.name,
          band: it.band,
          reason: it.reason,
        })),
      };
    },

    /**
     * POST /exams/:examId/result — parent enters per-question awarded scores;
     * DạyZi classifies every lost point (deterministic — same signal logic as the
     * gap engine, scoped to this exam). Does NOT mutate the Twin.
     */
    async recordExamResult(
      auth: CallerAuth,
      childId: string,
      examId: string,
      outcomes: readonly {
        questionRef: string;
        skillId: string;
        awardedScore: number;
        reasoningQuality?: 'weak' | 'adequate' | 'strong';
        stepsObserved?: readonly string[];
      }[],
    ) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'manage_child');
      const exam = (
        await pool.query(`SELECT id FROM exams WHERE id = $1 AND child_id = $2`, [examId, childId])
      ).rows[0];
      if (!exam) throw new NotFoundError('exam');

      const s = await refreshLearningState(childId);
      const typed: AssessmentQuestionOutcome[] = outcomes.map((o) => ({
        questionRef: o.questionRef,
        skillId: o.skillId as never,
        awardedScore: Math.max(0, Math.min(1, o.awardedScore)),
        ...(o.reasoningQuality ? { reasoningQuality: o.reasoningQuality } : {}),
        ...(o.stepsObserved ? { stepsObserved: [...o.stepsObserved] } : {}),
      }));
      const diagnosis = diagnoseAssessment({
        childId: asChildId(childId),
        examId,
        outcomes: typed,
        twin: s.twin,
        knowledgeBase: kb,
      });
      await pool.query(
        `INSERT INTO exam_results (exam_id, child_id, outcomes, diagnosis, recorded_by_user_id)
         VALUES ($1,$2,$3::jsonb,$4::jsonb,$5)
         ON CONFLICT (exam_id) DO UPDATE SET
           outcomes = EXCLUDED.outcomes, diagnosis = EXCLUDED.diagnosis,
           recorded_by_user_id = EXCLUDED.recorded_by_user_id, recorded_at = now()`,
        [examId, childId, JSON.stringify(typed), JSON.stringify(diagnosis), ctx.userId],
      );
      await pool.query(`UPDATE exams SET status = 'COMPLETED', updated_at = now() WHERE id = $1`, [examId]);
      return this_examDiagnosisDto(diagnosis);
    },

    async getExamDiagnosis(auth: CallerAuth, childId: string, examId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const row = (
        await pool.query(
          `SELECT diagnosis FROM exam_results WHERE exam_id = $1 AND child_id = $2`,
          [examId, childId],
        )
      ).rows[0] as { diagnosis: unknown } | undefined;
      if (!row?.diagnosis) return null;
      return this_examDiagnosisDto(row.diagnosis as ReturnType<typeof diagnoseAssessment>);
    },

    // ---- SCHOOL / CLASS -----------------------------------------

    async searchSchools(
      auth: CallerAuth,
      query: { nameFragment?: string; province?: string; district?: string },
    ) {
      await deriveContext(auth);
      const rows = await base.directory.searchSchools(query);
      return rows.map((s) => ({
        id: s.id,
        officialName: s.officialName,
        shortName: s.shortName,
        province: s.province,
        district: s.district,
        verificationStatus: s.verificationStatus,
      }));
    },

    async proposeSchool(
      auth: CallerAuth,
      input: {
        officialName: string;
        province?: string;
        district?: string;
        ward?: string;
        address?: string;
        schoolType?: 'PRIMARY' | 'LOWER_SECONDARY' | 'UPPER_SECONDARY' | 'K12' | 'OTHER';
      },
    ) {
      const ctx = await deriveContext(auth);
      const res = await base.directory.proposeSchool({ ...input, createdBy: ctx.userId });
      return {
        school: {
          id: res.school.id,
          officialName: res.school.officialName,
          verificationStatus: res.school.verificationStatus,
        },
        deduplicated: res.deduplicated,
        similarCandidates: res.similarCandidates.map((s) => ({ id: s.id, officialName: s.officialName })),
      };
    },

    async listAcademicYears(auth: CallerAuth) {
      await deriveContext(auth);
      return (await base.directory.listAcademicYears()).map((y) => ({
        id: y.id,
        label: y.label,
        startDate: y.startDate,
        endDate: y.endDate,
        status: y.status,
      }));
    },

    async listSubjects(auth: CallerAuth) {
      await deriveContext(auth);
      return (await base.directory.listSubjects()).map((s) => ({ id: s.id, code: s.code, name: s.name, status: s.status }));
    },

    async listClasses(auth: CallerAuth, schoolId: string, academicYearId: string) {
      await deriveContext(auth);
      return (await base.directory.listClassrooms(schoolId, academicYearId)).map((c) => ({
        id: c.id,
        grade: c.grade,
        className: c.className,
        displayName: c.displayName,
        verificationStatus: c.verificationStatus,
      }));
    },

    async proposeClass(
      auth: CallerAuth,
      schoolId: string,
      input: { academicYearId: string; grade: number; className: string; displayName?: string },
    ) {
      const ctx = await deriveContext(auth);
      const res = await base.directory.proposeClassroom({ schoolId, ...input, createdBy: ctx.userId });
      return { id: res.classroom.id, className: res.classroom.className, deduplicated: res.deduplicated };
    },

    // ---- RELATIONSHIPS -----------------------------------------

    async listRelationshipRequests(auth: CallerAuth) {
      const ctx = await deriveContext(auth);
      const [inbox, outbox] = await Promise.all([
        base.relationships.listInbox(ctx.userId),
        base.relationships.listOutbox(ctx.userId),
      ]);
      // A TEACHER→CHILD request minted from an invite code targets the child, not
      // a user, so it never lands in listInbox (which keys on target_user_id).
      // Fold in the pending requests for every child this caller guards.
      const merged = new Map(inbox.map((r) => [r.id, r]));
      if (ctx.workspace === 'PARENT') {
        const childRows = (
          await pool.query(
            `SELECT child_id FROM parent_child_relationships
              WHERE parent_user_id = $1 AND status = 'ACTIVE'`,
            [ctx.userId],
          )
        ).rows as Array<{ child_id: string }>;
        for (const { child_id } of childRows) {
          for (const r of await base.relStore.listRequestsForChild(child_id)) {
            if (!merged.has(r.id)) merged.set(r.id, r);
          }
        }
      }
      return {
        inbox: [...merged.values()].map(requestDto),
        outbox: outbox.map(requestDto),
      };
    },

    async createRelationshipRequest(
      auth: CallerAuth,
      input: {
        relationshipKind: 'TEACHER_CHILD' | 'TEACHER_PARENT';
        targetType: 'PARENT' | 'CHILD' | 'TEACHER';
        targetChildId?: string;
        targetUserId?: string;
        subjectId?: string;
        relationshipType?:
          | 'CLASS_TEACHER'
          | 'SUBJECT_TEACHER'
          | 'PRIVATE_TUTOR'
          | 'COACH'
          | 'MENTOR'
          | 'OTHER';
        accessSource?: 'PARENT_DIRECT' | 'CLASS_ASSIGNMENT' | 'SCHOOL_AUTHORIZATION';
        proposedPermissions?: readonly PermissionCode[];
        message?: string;
      },
    ) {
      const ctx = await deriveContext(auth);
      const requesterRole: 'PARENT' | 'TEACHER' = ctx.workspace === 'TEACHER' ? 'TEACHER' : 'PARENT';
      const req = await base.relationships.createRequest({
        requesterUserId: ctx.userId,
        requesterRole,
        ...input,
      });
      return requestDto(req);
    },

    async acceptRelationshipRequest(
      auth: CallerAuth,
      requestId: string,
      approvedPermissions?: readonly PermissionCode[],
    ) {
      const ctx = await deriveContext(auth);
      return withTransaction(pool, async (client) => {
        const svc = buildServices(client, now, logger);
        const res = await svc.relationships.acceptRequest(requestId, ctx.userId, approvedPermissions);
        analytics.track({ category: 'relationship', action: 'teacher_connected', actorRef: actorRef(ctx.userId) });
        return { request: requestDto(res.request), link: linkDto(res.link) };
      });
    },

    async rejectRelationshipRequest(auth: CallerAuth, requestId: string) {
      const ctx = await deriveContext(auth);
      await withTransaction(pool, async (client) => {
        await buildServices(client, now, logger).relationships.rejectRequest(requestId, ctx.userId);
      });
      return { ok: true };
    },

    async cancelRelationshipRequest(auth: CallerAuth, requestId: string) {
      const ctx = await deriveContext(auth);
      await withTransaction(pool, async (client) => {
        await buildServices(client, now, logger).relationships.cancelRequest(requestId, ctx.userId);
      });
      return { ok: true };
    },

    async revokeTeacherChildLink(auth: CallerAuth, linkId: string) {
      const ctx = await deriveContext(auth);
      await withTransaction(pool, async (client) => {
        await buildServices(client, now, logger).relationships.revokeTeacherChildLink(linkId, ctx.userId);
      });
      return { ok: true };
    },

    async listTeacherLinks(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      await authorizeChild(ctx, childId, 'view_child');
      const links = await base.relationships.listChildRelationships(childId);
      const out = [];
      for (const l of links) {
        const dto = linkDto(l) as ReturnType<typeof linkDto> & { teacherName: string | null };
        const row = (
          await pool.query(`SELECT display_name FROM users WHERE id = $1`, [dto.teacherUserId])
        ).rows[0] as { display_name: string | null } | undefined;
        dto.teacherName = row?.display_name ?? null;
        out.push(dto);
      }
      return out;
    },

    async getTeacherLinkPermissions(auth: CallerAuth, childId: string, linkId: string) {
      const ctx = await deriveContext(auth);
      await authorizeChild(ctx, childId, 'view_child');
      const link = await base.relStore.getTeacherChildLink(linkId);
      if (!link || link.childId !== childId) throw new NotFoundError('teacher link');
      const grants = await base.relStore.listGrantsForLink(linkId);
      return {
        linkId,
        subjectId: link.subjectId,
        grants: grants
          .filter((g) => g.status === 'ACTIVE')
          .map((g) => ({ code: g.permissionCode, accessSource: g.accessSource })),
      };
    },

    /** PATCH /children/:childId/teacher-links/:id/permissions — needs can_manage_privacy. */
    async updateTeacherLinkPermissions(
      auth: CallerAuth,
      childId: string,
      linkId: string,
      change: { grant?: readonly PermissionCode[]; revoke?: readonly PermissionCode[] },
    ) {
      const ctx = await deriveContext(auth);
      await authorizeChild(ctx, childId, 'grant_permission'); // → can_manage_privacy
      return withTransaction(pool, async (client) => {
        const svc = buildServices(client, now, logger);
        const link = await svc.relStore.getTeacherChildLink(linkId);
        if (!link || link.childId !== childId) throw new NotFoundError('teacher link');
        if (link.status !== 'ACCEPTED') throw new ForbiddenError('link is not ACCEPTED');
        for (const code of change.grant ?? []) {
          await svc.permissions.grant({
            linkId,
            linkType: 'TEACHER_CHILD',
            code,
            subjectId: link.subjectId,
            accessSource: 'PARENT_DIRECT',
            grantedByUserId: ctx.userId,
          });
          await svc.relStore.appendAuditEvent(auditRow(ctx, 'PERMISSION_GRANTED', linkId, childId, { code }));
        }
        for (const code of change.revoke ?? []) {
          await svc.permissions.revokeGrant(linkId, code);
          await svc.relStore.appendAuditEvent(auditRow(ctx, 'PERMISSION_REVOKED', linkId, childId, { code }));
        }
        const grants = await svc.relStore.listGrantsForLink(linkId);
        return {
          linkId,
          grants: grants.filter((g) => g.status === 'ACTIVE').map((g) => ({ code: g.permissionCode })),
        };
      });
    },

    // ---- DISCOVERY --------------------------------------------

    async createInviteCode(
      auth: CallerAuth,
      input: {
        childId: string;
        subjectId?: string;
        proposedPermissions?: readonly PermissionCode[];
        ttlHours?: number;
        uses?: number;
      },
    ) {
      const ctx = await deriveContext(auth);
      const code = await base.relationships.generateInviteCode({
        childId: input.childId,
        guardianUserId: ctx.userId,
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
        ...(input.proposedPermissions ? { proposedPermissions: input.proposedPermissions } : {}),
        ...(input.ttlHours ? { ttlHours: input.ttlHours } : {}),
        ...(input.uses ? { uses: input.uses } : {}),
      });
      return { code: code.code, expiresAt: code.expiresAt, proposedPermissions: code.proposedPermissions };
    },

    async redeemInviteCode(auth: CallerAuth, code: string) {
      const ctx = await deriveContext(auth);
      const req = await base.relationships.redeemInviteCode(code, ctx.userId);
      // Notify every ACTIVE guardian of the target child that a request is
      // waiting on them — first concrete `NotificationDeliveryAdapter` call
      // site (P7). Best-effort: a delivery failure never fails the redeem.
      if (req.targetChildId) {
        const guardians = (
          await pool.query(
            `SELECT parent_user_id FROM parent_child_relationships WHERE child_id = $1 AND status = 'ACTIVE'`,
            [req.targetChildId],
          )
        ).rows as { parent_user_id: string }[];
        const notif = makeNotification('relationship_request_received', {
          targetUserId: '', // overwritten per guardian below
          at: now().toISOString(),
          newId: () => globalThis.crypto.randomUUID(),
        });
        await Promise.all(
          guardians.map((g) =>
            notifications.send(g.parent_user_id, { ...notif, targetUserId: g.parent_user_id }).catch(() => undefined),
          ),
        );
      }
      return requestDto(req);
    },

    /** POST /users/email-exists — { exists: boolean } ONLY. Never any child. */
    async emailExists(auth: CallerAuth, email: string) {
      await deriveContext(auth);
      return base.discovery.emailLookup(email);
    },

    // ---- TEACHER ---------------------------------------------

    async teacherListChildren(auth: CallerAuth) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'TEACHER') throw new ForbiddenError('TEACHER workspace required');
      const links = (await base.relStore.listTeacherChildLinks({ teacherUserId: ctx.userId })).filter(
        (l) => l.status === 'ACCEPTED',
      );
      const out: Array<{ childId: string; displayName: string; subjectId: string | null; schoolGrade: number }> = [];
      for (const l of links) {
        const row = (await pool.query(`SELECT display_name, school_grade FROM child_profiles WHERE id = $1`, [l.childId]))
          .rows[0] as any;
        if (row) {
          out.push({
            childId: l.childId,
            displayName: row.display_name,
            subjectId: l.subjectId,
            schoolGrade: row.school_grade,
          });
        }
      }
      return out;
    },

    /**
     * GET /teacher/curriculum-program?grade=4|7 — the SGK chapter/lesson list
     * for the "Bài đang dạy" / "Tiến độ chương trình" pickers, so a teacher
     * ticks lessons instead of typing free text. Static curriculum content
     * (no child data) — any authenticated teacher may read it. Only one
     * curriculum series (Kết nối tri thức) is seeded today; a grade with no
     * calendar yet returns an empty chapter list rather than an error, so a
     * future gap in the data shows as "nothing to pick" not a crash.
     */
    async teacherGetCurriculumProgram(auth: CallerAuth, grade: number) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'TEACHER') throw new ForbiddenError('TEACHER workspace required');
      if (grade !== 4 && grade !== 7) throw new ForbiddenError('grade phải là 4 hoặc 7');
      return curriculumProgramFor(grade);
    },

    /**
     * GET /curriculum-program?grade=4|7 — same SGK chapter/lesson list, for the
     * PARENT onboarding "con đang học đến bài nào?" picker. Static curriculum
     * content, no child data — any authenticated caller may read it.
     */
    async getCurriculumProgram(auth: CallerAuth, grade: number) {
      await deriveContext(auth); // authenticated only
      if (grade !== 4 && grade !== 7) throw new ForbiddenError('grade phải là 4 hoặc 7');
      return curriculumProgramFor(grade);
    },

    /**
     * POST /children/:id/learning-start (doc 70 onboarding) — the parent tells
     * DạyZi where the child actually is: an optional school + class label, and
     * the lesson the child has most recently studied. The lesson becomes a
     * PARENT lesson-confirmation (confidence STRONG) so the Curriculum Clock
     * resolves the real position instead of estimating from the calendar date —
     * everything before it is "đã học", everything after is "chưa học".
     */
    async setChildLearningStart(
      auth: CallerAuth,
      childId: string,
      input: { lessonId: string; schoolName?: string; className?: string },
    ) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'manage_child');
      const schoolName = (input.schoolName ?? '').trim();
      const className = (input.className ?? '').trim();
      if (schoolName || className) {
        await pool.query(
          `UPDATE child_profiles
              SET school_context = school_context
                    || jsonb_build_object('name', $2::text, 'className', $3::text)
            WHERE id = $1`,
          [childId, schoolName || null, className || null],
        );
      }
      const { scoped } = await learningScene(childId);
      const res = await scoped.confirmLesson(parentDelegateCtx(ctx.userId), childId, {
        lessonId: input.lessonId,
        confidence: 'STRONG',
        ...(className ? { topicNote: `Lớp ${className}${schoolName ? ` · ${schoolName}` : ''}` } : {}),
      });
      logger.info('learning start set', { actor: actorRef(ctx.userId), lessonId: input.lessonId });
      return { resolved: res.resolved, expected: res.expected };
    },

    /**
     * POST /teacher/children/:childId/ocr-homework — best-effort OCR read of a
     * homework-sheet photo into free text the teacher can review/edit before
     * submitting a HOMEWORK contribution. Nothing is persisted here — no
     * upload ledger row, no evidence, no skill mapping kept — this only fills
     * a text field faster than typing. Reuses the SAME document-vision
     * adapter as the parent evidence-upload flow (mock by default; never a
     * paid call unless the operator explicitly wired + enabled a live one).
     */
    async teacherOcrHomework(auth: CallerAuth, childId: string, input: { mimeType: string; contentBase64: string }) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'TEACHER') throw new ForbiddenError('TEACHER workspace required');
      const links = (
        await base.relStore.listTeacherChildLinks({ teacherUserId: ctx.userId, childId })
      ).filter((l) => l.status === 'ACCEPTED');
      if (links.length === 0) throw new ForbiddenError('chưa được phụ huynh chấp thuận kết nối với học sinh này');
      const bytes = new Uint8Array(Buffer.from(input.contentBase64, 'base64'));
      if (bytes.byteLength === 0) throw new ForbiddenError('ảnh trống');
      if (bytes.byteLength > 12 * 1024 * 1024) throw new ForbiddenError('ảnh quá lớn (tối đa 12MB)');
      const row = (
        await pool.query(`SELECT school_grade FROM child_profiles WHERE id = $1`, [childId])
      ).rows[0] as { school_grade: number } | undefined;
      const grade = row?.school_grade ?? 4;
      const extraction = await documentVision.analyze({
        bytes,
        mimeType: input.mimeType,
        childGrade: grade,
        kindHint: 'HOMEWORK',
        knownSkillIds: gradeBandSkillIds(grade),
      });
      const text =
        extraction.items.map((it, i) => `${i + 1}. ${it.prompt}`).join('\n') || extraction.teacherNote || '';
      return { text, itemCount: extraction.items.length };
    },

    async teacherGetPermissions(auth: CallerAuth, childId: string, subjectId?: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'TEACHER') throw new ForbiddenError('TEACHER workspace required');
      const codes = await base.permissions.effectiveCodes(ctx.userId, childId, subjectId ?? null, now());
      return { childId, subjectId: subjectId ?? null, codes };
    },

    async teacherSubmitContribution(
      auth: CallerAuth,
      childId: string,
      input: {
        subjectId: string;
        contributionType: import('@copilot/domain').TeacherContributionType;
        observedAt: string;
        taughtSkillIds?: readonly string[];
        homeworkRefs?: readonly string[];
        examRef?: { date: string; scopeNote?: string };
        confidence?: 'A' | 'B' | 'C' | 'D';
        visibility?: 'PARENT_AND_CHILD' | 'PARENT_ONLY';
      },
    ) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'TEACHER') throw new ForbiddenError('TEACHER workspace required');
      return withTransaction(pool, async (client) => {
        const svc = buildServices(client, now, logger);
        const c = await svc.contributions.submitContribution({
          teacherUserId: ctx.userId,
          childId,
          ...input,
        });
        return {
          id: c.id,
          contributionType: c.contributionType,
          subjectId: c.subjectId,
          relationshipSourceType: c.relationshipSourceType,
          relationshipSourceId: c.relationshipSourceId,
          confidence: c.confidence,
          visibility: c.visibility,
        };
      });
    },

    async teacherCreateAssignment(auth: CallerAuth, childId: string, _input: unknown) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'TEACHER') throw new ForbiddenError('TEACHER workspace required');
      await authorizeChild(ctx, childId, 'create_assignment');
      // The assignment goes through the normal spec→generate→validate pipeline
      // and is delivered to the child only in a non-SHADOW future (C4/C5 unchanged).
      throw new ForbiddenError('teacher assignment delivery is not enabled (LIVE generation is OFF)');
    },

    async teacherGetTwinSummary(auth: CallerAuth, childId: string, subjectId?: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'TEACHER') throw new ForbiddenError('TEACHER workspace required');
      await authorizeChild(ctx, childId, 'view_twin_summary', subjectId);
      const { twin } = await refreshLearningState(childId);
      // redacted — mastery band words only, no scores, no evidence, no behaviour
      const skills = [...twin.skillMastery.entries()]
        .slice(0, 12)
        .map(([skillId, s]) => ({
          skillId,
          skillName: kb.skills.get(skillId)?.name ?? skillId,
          band: s.mastery >= 75 ? 'vững' : s.mastery >= 50 ? 'đang_ổn_định' : 'cần_củng_cố',
        }));
      return { childId, skills };
    },

    async teacherGetGaps(auth: CallerAuth, childId: string, subjectId?: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'TEACHER') throw new ForbiddenError('TEACHER workspace required');
      await authorizeChild(ctx, childId, 'view_selected_gaps', subjectId);
      const { gaps } = await refreshLearningState(childId);
      return {
        childId,
        gaps: gaps.gaps.slice(0, 12).map((g) => ({
          skillId: g.targetSkillId,
          skillName: kb.skills.get(g.targetSkillId)?.name ?? g.targetSkillId,
          type: g.type,
          lifecycleState: g.lifecycleState,
        })),
      };
    },

    // ---- STUDENT -------------------------------------------

    async studentGetMe(auth: CallerAuth) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'STUDENT' || !ctx.childScope) throw new ForbiddenError('STUDENT workspace required');
      const row = (await pool.query(`SELECT id, display_name, school_grade FROM child_profiles WHERE id = $1`, [ctx.childScope])).rows[0] as any;
      return { childId: row.id, displayName: row.display_name, schoolGrade: row.school_grade };
    },

    async studentGetToday(auth: CallerAuth) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'STUDENT' || !ctx.childScope) throw new ForbiddenError('STUDENT workspace required');
      const childId = ctx.childScope;
      const { scoped } = await learningScene(childId);
      const preview = await scoped.childToday(
        { userId: ctx.userId, role: 'child', childScope: childId },
        childId,
      );

      // Rebuild `tasks` / counts from REAL assignments so a completed task
      // actually shows as done (the plan preview above always reports 0/0 and
      // regenerates every load). Assignments the student created today via
      // `POST /children/:id/practice` are the trackable unit of work.
      const MODE_LABEL: Record<string, string> = {
        PRACTICE: 'Bài tập',
        WORKSHEET: 'Bài tập',
        GAP_REPAIR: 'Ôn tập',
        REVISION: 'Ôn tập',
        CHALLENGE: 'Thử thách',
        DIAGNOSTIC: 'Bài kiểm tra nhỏ',
      };
      const today = now().toISOString().slice(0, 10);
      const all = await base.learningState.listAssignmentsForChild(childId);
      const todays = all.filter(
        (a) => a.createdAt.slice(0, 10) === today && a.status !== 'CANCELLED',
      );
      const open = todays.filter((a) => a.status !== 'COMPLETED');
      const doneCount = todays.length - open.length;

      const tasks = open.map((a) => ({
        assignmentId: a.id,
        title: MODE_LABEL[a.mode] ?? 'Bài tập',
        subtitle: `${a.targetSkillIds.length} kỹ năng`,
        kind: (a.mode === 'CHALLENGE' ? 'challenge' : a.mode === 'GAP_REPAIR' || a.mode === 'REVISION' ? 'review' : 'practice') as
          | 'challenge'
          | 'review'
          | 'practice',
        assignedBy: (a.assignedByRole === 'PARENT' ? 'parent' : 'app') as 'parent' | 'app',
      }));

      let summary: string;
      if (open.length > 0) summary = `Con còn ${open.length} việc hôm nay.`;
      else if (doneCount > 0) summary = 'Con đã làm xong bài hôm nay rồi! Giỏi lắm.';
      else if (preview.tasks.length > 0)
        // the plan has work but the student hasn't started a session yet
        summary = 'Hôm nay con có bài để luyện. Nhấn để bắt đầu nhé!';
      else summary = preview.summary; // `no_plan_needed` reason

      const view = { ...preview, summary, tasks, doneCount, totalCount: todays.length };
      assertChildSafe(view);
      return view;
    },

    async studentGetAssignments(auth: CallerAuth) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'STUDENT' || !ctx.childScope) throw new ForbiddenError('STUDENT workspace required');
      const rows = await base.learningState.listAssignmentsForChild(ctx.childScope);
      return rows.map((a) => ({
        id: a.id,
        status: a.status,
        mode: a.mode,
        targetSkillIds: a.targetSkillIds,
        createdAt: a.createdAt,
        completedAt: a.completedAt,
      }));
    },

    /** GET /student/review — skills to revisit + unfinished work (child-safe words). */
    async studentGetReview(auth: CallerAuth) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'STUDENT' || !ctx.childScope) throw new ForbiddenError('STUDENT workspace required');
      const childId = ctx.childScope;
      const { gaps } = await refreshLearningState(childId);
      const assignments = await base.learningState.listAssignmentsForChild(childId);
      return {
        revisit: gaps.gaps
          .slice(0, 5)
          .map((g) => ({ topic: kb.skills.get(g.targetSkillId)?.name ?? g.targetSkillId })),
        unfinished: assignments.filter((a) => a.status === 'IN_PROGRESS').length,
        recent: assignments.filter((a) => a.status === 'COMPLETED').slice(0, 3).length,
      };
    },

    /** GET /student/progress — friendly, no numbers. */
    async studentGetProgress(auth: CallerAuth) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'STUDENT' || !ctx.childScope) throw new ForbiddenError('STUDENT workspace required');
      const childId = ctx.childScope;
      const { twin } = await refreshLearningState(childId);
      const skills = [...twin.skillMastery.entries()];
      const solid = skills.filter(([, s]) => s.mastery >= 75).map(([id]) => kb.skills.get(id)?.name ?? id);
      const growing = skills.filter(([, s]) => s.mastery >= 45 && s.mastery < 75).map(([id]) => kb.skills.get(id)?.name ?? id);
      const completed = (await base.learningState.listAssignmentsForChild(childId)).filter((a) => a.status === 'COMPLETED').length;
      return {
        streakDone: completed,
        solid: solid.slice(0, 4),
        growing: growing.slice(0, 4),
        line:
          solid.length > 0
            ? `Con đang chắc hơn ở ${solid[0]}.`
            : 'Con vừa bắt đầu — làm vài bài để DạyZi hiểu con hơn nhé.',
      };
    },

    // ---- STUDENT ACCOUNT LINKING (parent side) ------------------

    /** POST /children/:childId/student-access — parent creates + links a student login. */
    async createStudentAccess(
      auth: CallerAuth,
      childId: string,
      input: { displayName?: string; password: string },
    ) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'link_student'); // → can_manage_child
      const existing = await pool.query(
        `SELECT u.primary_email FROM student_account_links l JOIN users u ON u.id = l.user_id
          WHERE l.child_id = $1 AND l.status = 'ACTIVE'`,
        [childId],
      );
      if (existing.rows[0]) {
        return { loginEmail: (existing.rows[0] as any).primary_email as string, alreadyExists: true };
      }
      const loginEmail = `hs-${childId.slice(0, 8)}@dayzi.local`;
      const student = await registrar.register({
        email: loginEmail,
        password: input.password,
        intendedRole: 'STUDENT',
        ...(input.displayName ? { displayName: input.displayName } : {}),
      });
      await base.identity.linkStudentAccount({
        studentUserId: student.user.id as never,
        childId,
        linkMethod: 'GUARDIAN_MANUAL',
        linkedByUserId: ctx.userId as never,
      });
      return { loginEmail, alreadyExists: false };
    },

    async getStudentAccess(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const r = await pool.query(
        `SELECT u.primary_email, l.status, l.created_at FROM student_account_links l
           JOIN users u ON u.id = l.user_id WHERE l.child_id = $1 ORDER BY l.created_at DESC LIMIT 1`,
        [childId],
      );
      const x = r.rows[0] as any;
      return x
        ? {
            loginEmail: x.primary_email as string,
            status: x.status as string,
            createdAt: new Date(x.created_at).toISOString(),
          }
        : null;
    },

    async revokeStudentAccess(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'link_student');
      await withTransaction(pool, async (client) => {
        await client.query(
          `UPDATE student_account_links SET status = 'REVOKED', revoked_at = now()
            WHERE child_id = $1 AND status = 'ACTIVE'`,
          [childId],
        );
      });
      return { ok: true };
    },

    // ---- M7: ENTITLEMENTS / PLAN ------------------------------------

    /** GET /me/entitlements — the caller's family plan + what it unlocks. */
    async getEntitlements(auth: CallerAuth) {
      const ctx = await deriveContext(auth);
      const sub = await familySubscription(ctx.userId);
      const plan = await familyPlan(ctx.userId);
      const ent = entitlementsFor(plan);
      const childCount = (
        await pool.query(
          `SELECT count(*)::int n FROM parent_child_relationships r
             JOIN child_profiles c ON c.id = r.child_id
            WHERE r.parent_user_id = $1 AND r.status = 'ACTIVE' AND c.deletion_state <> 'deleted'`,
          [ctx.userId],
        )
      ).rows[0] as { n: number };
      return {
        plan,
        entitlements: ent,
        options: PLANS.map((p) => ({
          plan: p,
          priceVnd: entitlementsFor(p).priceVnd,
          recommended: entitlementsFor(p).recommended,
        })),
        usage: { children: childCount.n, maxChildren: ent.maxChildren },
        // P9 — billing readiness: subscription provenance/lifecycle detail for
        // a "Manage subscription" screen. `source: 'none'|'manual'` means
        // there is still no real store subscription — billing is MOCK.
        subscription: {
          status: sub.status,
          source: sub.source,
          currentPeriodEnd: sub.currentPeriodEnd,
          gracePeriodEnd: sub.gracePeriodEnd,
          autoRenew: sub.autoRenew,
        },
      };
    },

    /**
     * POST /me/plan — MOCK plan change. There is NO billing: no card, no
     * invoice, no gateway. It only moves the feature/quota gate. The plan NEVER
     * changes which AI model runs.
     */
    async setPlan(auth: CallerAuth, plan: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      if (!(PLANS as readonly string[]).includes(plan)) throw new ForbiddenError('unknown plan');
      const fam = (
        await pool.query(
          `SELECT f.id FROM families f JOIN family_memberships m ON m.family_id = f.id
            WHERE m.user_id = $1 AND m.member_role = 'OWNER' LIMIT 1`,
          [ctx.userId],
        )
      ).rows[0] as { id: string } | undefined;
      if (!fam) throw new ForbiddenError('only the family owner may change the plan');
      await pool.query(
        `INSERT INTO family_subscriptions
           (family_id, plan, status, current_period_end, updated_at, source, store_transaction_id, grace_period_end, auto_renew)
         VALUES ($1, $2, 'active', now() + interval '30 days', now(), 'manual', NULL, NULL, false)
         ON CONFLICT (family_id) DO UPDATE SET plan = EXCLUDED.plan, status = 'active',
           current_period_end = EXCLUDED.current_period_end, updated_at = now(),
           source = 'manual', store_transaction_id = NULL, grace_period_end = NULL, auto_renew = false`,
        [fam.id, plan],
      );
      return { plan: plan as import('@copilot/domain').Plan, billing: 'MOCK_NO_CHARGE' as const };
    },

    /**
     * POST /me/billing/restore-purchase — P9 billing readiness. Validates a
     * store receipt/purchase token via `@copilot/billing`'s
     * `ReceiptValidationAdapter` and, if valid, applies the resulting
     * `applyBillingEvent({kind:'purchased', ...})` to the family's
     * subscription. This NEVER creates a charge — it only reads back a
     * purchase the user already completed in the App Store / Play Store's
     * own UI (the standard "Restore Purchases" flow both stores require).
     *
     * With no `DZ_BILLING` env set (today, everywhere), the resolved adapter
     * is `Noop` and this always returns `{restored:false}` — billing stays
     * MOCK exactly as before. `DZ_BILLING=mock` exercises the full
     * port→domain→persistence path in dev/tests with a fake receipt.
     * `DZ_BILLING=live` requires real Apple/Google credentials the app does
     * not have configured; until that integration is actually built the
     * adapter throws rather than silently doing nothing.
     */
    async restorePurchase(auth: CallerAuth, input: { store: 'apple' | 'google'; receipt: string }) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      const fam = (
        await pool.query(
          `SELECT f.id FROM families f JOIN family_memberships m ON m.family_id = f.id
            WHERE m.user_id = $1 AND m.member_role = 'OWNER' LIMIT 1`,
          [ctx.userId],
        )
      ).rows[0] as { id: string } | undefined;
      if (!fam) throw new ForbiddenError('only the family owner may restore a purchase');

      const adapter = input.store === 'apple' ? receiptValidation.apple : receiptValidation.google;
      const result = await adapter.validate({ store: input.store, receipt: input.receipt });
      if (!result.valid || !result.plan || !result.periodEnd) {
        return { restored: false as const, reason: result.reason ?? 'receipt not valid' };
      }

      const now = new Date().toISOString();
      const current = await familySubscription(ctx.userId);
      const next = applyBillingEvent(current, {
        kind: 'purchased',
        plan: result.plan,
        source: input.store,
        storeTransactionId: result.storeTransactionId,
        periodEnd: result.periodEnd,
        now,
      });
      await pool.query(
        `INSERT INTO family_subscriptions
           (family_id, plan, status, current_period_end, updated_at, source, store_transaction_id, grace_period_end, auto_renew)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (family_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status,
           current_period_end = EXCLUDED.current_period_end, updated_at = EXCLUDED.updated_at,
           source = EXCLUDED.source, store_transaction_id = EXCLUDED.store_transaction_id,
           grace_period_end = EXCLUDED.grace_period_end, auto_renew = EXCLUDED.auto_renew`,
        [
          fam.id,
          next.plan,
          next.status,
          next.currentPeriodEnd,
          next.updatedAt,
          next.source,
          next.storeTransactionId,
          next.gracePeriodEnd,
          next.autoRenew,
        ],
      );
      return { restored: true as const, plan: next.plan, currentPeriodEnd: next.currentPeriodEnd };
    },

    // ---- M7: REAL CHILD-PROFILE DELETION ---------------------------

    async getChildDeletionStatus(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const r = (
        await pool.query(
          `SELECT d.state, d.requested_at, d.confirmed_at, c.display_name, c.deletion_state
             FROM child_profiles c
             LEFT JOIN child_deletion_requests d ON d.child_id = c.id
                   AND d.state IN ('REQUESTED','CONFIRMED')
            WHERE c.id = $1`,
          [childId],
        )
      ).rows[0] as any;
      if (!r) throw new NotFoundError('child');
      return {
        childName: r.display_name,
        deletionState: r.deletion_state,
        request: r.state ? { state: r.state, requestedAt: String(r.requested_at) } : null,
      };
    },

    /** POST /children/:childId/deletion — start the workflow (reversible until confirmed). */
    async requestChildDeletion(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'manage_child');
      await authorizeChild(ctx, childId, 'grant_permission'); // → can_manage_privacy
      await withTransaction(pool, async (client) => {
        await client.query(
          `UPDATE child_profiles SET deletion_state = 'deletion_requested' WHERE id = $1 AND deletion_state = 'active'`,
          [childId],
        );
        await client.query(
          `INSERT INTO child_deletion_requests (child_id, requested_by_user_id, state)
           VALUES ($1, $2, 'REQUESTED')
           ON CONFLICT (child_id) DO UPDATE SET state = 'REQUESTED', requested_by_user_id = EXCLUDED.requested_by_user_id,
             requested_at = now(), confirmed_at = NULL, completed_at = NULL, updated_at = now()`,
          [childId, ctx.userId],
        );
      });
      return { ok: true };
    },

    async cancelChildDeletion(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'manage_child');
      await withTransaction(pool, async (client) => {
        await client.query(
          `UPDATE child_profiles SET deletion_state = 'active' WHERE id = $1 AND deletion_state = 'deletion_requested'`,
          [childId],
        );
        await client.query(
          `UPDATE child_deletion_requests SET state = 'CANCELLED', updated_at = now()
            WHERE child_id = $1 AND state IN ('REQUESTED','CONFIRMED')`,
          [childId],
        );
      });
      return { ok: true };
    },

    /**
     * POST /children/:childId/deletion/confirm — HARD delete. The parent must
     * re-type the child's display name. Purges every child-scoped row (the
     * append-only ledgers included) and the profile itself, then records an
     * append-only `deletion_jobs` audit row. Not a soft-hide.
     */
    async confirmChildDeletion(auth: CallerAuth, childId: string, confirmName: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'manage_child');
      await authorizeChild(ctx, childId, 'grant_permission');
      const child = (
        await pool.query(`SELECT display_name FROM child_profiles WHERE id = $1`, [childId])
      ).rows[0] as { display_name: string } | undefined;
      if (!child) throw new NotFoundError('child');
      if (confirmName.trim() !== child.display_name.trim()) {
        throw new ForbiddenError('Tên bạn nhập chưa khớp với tên hiển thị của con — hãy nhập chính xác để xác nhận xóa.');
      }

      const summary = await withTransaction(pool, async (client) => {
        // student user(s) linked to this child (deleted too — the login only exists for this child)
        const studentUsers = (
          await client.query(`SELECT user_id FROM student_account_links WHERE child_id = $1`, [childId])
        ).rows.map((x: { user_id: string }) => x.user_id);

        await client.query(`SET session_replication_role = replica`);
        const counts: Record<string, number> = {};
        const del = async (label: string, sql: string, params: unknown[]) => {
          const r = await client.query(sql, params);
          counts[label] = r.rowCount ?? 0;
        };

        // child-scoped rows in dependency order
        await del('attempt_answers', `DELETE FROM attempt_answers WHERE attempt_id IN (SELECT id FROM attempts WHERE child_id = $1)`, [childId]);
        await del('attempts', `DELETE FROM attempts WHERE child_id = $1`, [childId]);
        await del('assignment_items', `DELETE FROM assignment_items WHERE assignment_id IN (SELECT id FROM assignments WHERE child_id = $1)`, [childId]);
        await del('assignments', `DELETE FROM assignments WHERE child_id = $1`, [childId]);
        await del('plan_items', `DELETE FROM plan_items WHERE learning_plan_id IN (SELECT id FROM learning_plans WHERE child_id = $1)`, [childId]);
        await del('learning_plans', `DELETE FROM learning_plans WHERE child_id = $1`, [childId]);
        await del('gap_prescriptions', `DELETE FROM gap_prescriptions WHERE child_id = $1`, [childId]);
        await del('knowledge_gaps', `DELETE FROM knowledge_gaps WHERE child_id = $1`, [childId]);
        await del('skill_states', `DELETE FROM skill_states WHERE child_id = $1`, [childId]);
        await del('problem_type_mastery', `DELETE FROM problem_type_mastery WHERE child_id = $1`, [childId]);
        await del('thinking_state', `DELETE FROM thinking_state WHERE child_id = $1`, [childId]);
        await del('learning_state_snapshots', `DELETE FROM learning_state_snapshots WHERE child_id = $1`, [childId]);
        await del('learning_context_snapshots', `DELETE FROM learning_context_snapshots WHERE child_id = $1`, [childId]);
        await del('lesson_confirmations', `DELETE FROM lesson_confirmations WHERE child_id = $1`, [childId]);
        // doc 66/67: the worksheet-orchestrator + durable-queue tables key on
        // `generation_spec_id` (plain text, no FK) — the worksheet SHADOW path
        // mints its OWN `egs_*` spec id and never writes `generation_specs`, so
        // deletion must scope by the pseudonymous `child_ref` (= sha256(childId)
        // .slice(0,16), the same value `resolveWorksheetGeneration.resolveChildRef`
        // stores). Purge these BEFORE `generation_specs`; slots/attempts
        // FK-cascade off the run.
        const wsRef = actorRef(childId);
        // spec ids of this child's worksheet runs/jobs — catches any review row
        // whose own child_ref was null (belt-and-suspenders).
        const wsSpecIds = (
          await client.query<{ generation_spec_id: string }>(
            `SELECT generation_spec_id FROM worksheet_generation_runs WHERE child_ref = $1
             UNION SELECT generation_spec_id FROM worksheet_jobs WHERE child_ref = $1`,
            [wsRef],
          )
        ).rows.map((r) => r.generation_spec_id);
        await del(
          'review_queue',
          `DELETE FROM review_queue WHERE child_ref = $1 OR generation_spec_id = ANY($2::text[])`,
          [wsRef, wsSpecIds],
        );
        await del('worksheet_jobs', `DELETE FROM worksheet_jobs WHERE child_ref = $1`, [wsRef]);
        await del(
          'worksheet_slot_attempts',
          `DELETE FROM worksheet_slot_attempts WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE child_ref = $1)`,
          [wsRef],
        );
        await del(
          'worksheet_slots',
          `DELETE FROM worksheet_slots WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE child_ref = $1)`,
          [wsRef],
        );
        await del('worksheet_generation_runs', `DELETE FROM worksheet_generation_runs WHERE child_ref = $1`, [wsRef]);
        // doc 69/70 — INTERNAL LIVE serving intents + QA samples + pilot feedback/activity
        // (all keyed by the pseudonymous child_ref)
        const servingPurged = await purgeServingForChild(client, wsRef);
        const qaPurged = await purgeInternalLiveForChild(client, wsRef);
        const pilotPurged = await purgePilotForChild(client, wsRef);
        logger.info('deletion: internal-live + pilot purged', { child: wsRef, servingPurged, qaPurged, pilotPurged });
        await del('generation_specs', `DELETE FROM generation_specs WHERE child_id = $1`, [childId]);
        await del('exam_results', `DELETE FROM exam_results WHERE child_id = $1`, [childId]);
        await del('exams', `DELETE FROM exams WHERE child_id = $1`, [childId]);
        await del('upload_analysis', `DELETE FROM upload_analysis WHERE child_id = $1`, [childId]);
        await del('uploads', `DELETE FROM uploads WHERE child_id = $1`, [childId]);
        await del('evidence', `DELETE FROM evidence WHERE child_id = $1`, [childId]);
        await del('teacher_contributions', `DELETE FROM teacher_contributions WHERE child_id = $1`, [childId]);
        await del('permission_grants', `DELETE FROM permission_grants WHERE subject_link_id IN (SELECT id FROM teacher_child_links WHERE child_id = $1)`, [childId]);
        await del('teacher_child_links', `DELETE FROM teacher_child_links WHERE child_id = $1`, [childId]);
        await del('teacher_parent_links', `DELETE FROM teacher_parent_links WHERE child_id = $1`, [childId]);
        await del('relationship_invite_codes', `DELETE FROM relationship_invite_codes WHERE child_id = $1`, [childId]);
        await del('relationship_requests', `DELETE FROM relationship_requests WHERE target_child_id = $1`, [childId]);
        await del('teacher_invites', `DELETE FROM teacher_invites WHERE child_id = $1`, [childId]);
        await del('student_class_enrollments', `DELETE FROM student_class_enrollments WHERE child_id = $1`, [childId]);
        await del('student_school_enrollments', `DELETE FROM student_school_enrollments WHERE child_id = $1`, [childId]);
        await del('child_school_enrollment', `DELETE FROM child_school_enrollment WHERE child_id = $1`, [childId]);
        await del('enrollment_transitions', `DELETE FROM enrollment_transitions WHERE child_id = $1`, [childId]);
        await del('consent_records', `DELETE FROM consent_records WHERE child_id = $1`, [childId]);
        await del('privacy_preferences', `DELETE FROM privacy_preferences WHERE child_id = $1`, [childId]);
        await del('child_credentials', `DELETE FROM child_credentials WHERE child_id = $1`, [childId]);
        await del('child_quick_access', `DELETE FROM child_quick_access WHERE child_id = $1`, [childId]);
        await del('student_account_links', `DELETE FROM student_account_links WHERE child_id = $1`, [childId]);
        await del('parent_child_relationships', `DELETE FROM parent_child_relationships WHERE child_id = $1`, [childId]);
        await del('audit_events', `DELETE FROM audit_events WHERE child_id = $1`, [childId]);
        await del('child_profiles', `DELETE FROM child_profiles WHERE id = $1`, [childId]);
        // student logins that existed only for this child
        for (const uid of studentUsers) {
          await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [uid]).catch(() => undefined);
          await client.query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => undefined);
        }
        await client.query(`SET session_replication_role = origin`);

        // append-only audit trail
        await client.query(
          `INSERT INTO deletion_jobs (child_id, requested_by, state, steps_completed, completed_at, audit_ref)
           VALUES ($1, $2, 'completed', $3::jsonb, now(), $4)`,
          [childId, ctx.userId, JSON.stringify(counts), `confirm-${now().toISOString()}`],
        );
        await client
          .query(
            `INSERT INTO child_deletion_requests (child_id, requested_by_user_id, state, confirmed_at, completed_at, purge_summary, updated_at)
             VALUES ($1,$2,'COMPLETED', now(), now(), $3::jsonb, now())
             ON CONFLICT (child_id) DO UPDATE SET state='COMPLETED', confirmed_at=now(), completed_at=now(),
               purge_summary=EXCLUDED.purge_summary, updated_at=now()`,
            [childId, ctx.userId, JSON.stringify(counts)],
          )
          .catch(() => undefined); // child_deletion_requests row is FK-cascade-gone once child_profiles is deleted
        return counts;
      });

      return { ok: true, purged: summary };
    },

    // ---- M4: EVIDENCE UPLOAD / DOCUMENT VISION ------------------------

    /** GET /children/:childId/uploads — ledger rows + current analysis state. */
    async listUploads(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const uploads = await uploadStore.listUploads(childId);
      const out = [];
      for (const u of uploads) {
        const a = await uploadStore.getAnalysisByUpload(u.id);
        if (a?.dismissedAt) continue; // parent removed this from their list
        out.push({
          id: u.id,
          kind: u.kind,
          originalFilename: u.originalFilename,
          mimeType: u.mimeType,
          byteSize: u.byteSize,
          createdAt: u.createdAt,
          state: a?.state ?? 'UPLOAD_CREATED',
          confidence: a?.confidence ?? null,
          // once confirmed, itemCount is how many items the parent actually
          // kept (became evidence) — not the raw extraction count, which
          // includes items the parent unticked
          itemCount:
            a?.state === 'CONFIRMED'
              ? (a.resultingEvidenceIds?.length ?? 0)
              : (a?.extraction?.items.length ?? 0),
          errorMessage: a?.errorMessage ?? null,
        });
      }
      return out;
    },

    /**
     * POST /children/:childId/uploads — parent uploads a page. `contentBase64`
     * is decoded, stored via the object-store adapter, and an analysis row is
     * opened (UPLOAD_CREATED → UPLOADED). NO paid call happens here.
     */
    async createUpload(
      auth: CallerAuth,
      childId: string,
      input: {
        kind: 'NOTEBOOK_PAGE' | 'GRADED_TEST' | 'HOMEWORK' | 'TEACHER_MESSAGE' | 'OTHER';
        filename: string;
        mimeType: string;
        contentBase64: string;
      },
    ) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'manage_child');
      const bytes = new Uint8Array(Buffer.from(input.contentBase64, 'base64'));
      if (bytes.byteLength === 0) throw new ForbiddenError('empty upload');
      if (bytes.byteLength > 12 * 1024 * 1024) throw new ForbiddenError('upload exceeds 12MB');
      const { upload, analysis } = await uploadIngestion.createUpload({
        childId,
        actorUserId: ctx.userId,
        kind: input.kind,
        filename: input.filename,
        mimeType: input.mimeType,
        bytes,
      });
      analytics.track({ category: 'upload', action: 'evidence_uploaded', actorRef: actorRef(ctx.userId), metadata: { kind: input.kind } });
      return { uploadId: upload.id, state: analysis.state };
    },

    /**
     * POST /children/:childId/uploads/:uploadId/analyze — run the (mock)
     * document-vision adapter: READING → ANALYZING → MAPPED → NEEDS_CONFIRMATION,
     * or FAILED. Still no paid call unless an operator explicitly wired a live
     * adapter.
     */
    async runUploadAnalysis(auth: CallerAuth, childId: string, uploadId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'manage_child');
      const upload = await uploadStore.getUpload(uploadId);
      if (!upload || upload.childId !== childId) throw new NotFoundError('upload');
      const grade = (
        await pool.query(`SELECT school_grade FROM child_profiles WHERE id = $1`, [childId])
      ).rows[0] as { school_grade: number } | undefined;
      const analysis = await uploadIngestion.runAnalysis({
        uploadId,
        childGrade: grade?.school_grade ?? 4,
        knownSkillIds: gradeBandSkillIds(grade?.school_grade ?? 4),
      });
      return uploadAnalysisDto(analysis, kb);
    },

    /** GET /children/:childId/uploads/:uploadId/analysis — for the review screen. */
    async getUploadAnalysis(auth: CallerAuth, childId: string, uploadId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const upload = await uploadStore.getUpload(uploadId);
      if (!upload || upload.childId !== childId) throw new NotFoundError('upload');
      const analysis = await uploadStore.getAnalysisByUpload(uploadId);
      if (!analysis) throw new NotFoundError('analysis');
      return uploadAnalysisDto(analysis, kb);
    },

    /**
     * POST /children/:childId/uploads/:uploadId/confirm — the parent reviews and
     * corrects the extraction. Only confirmed items become append-only evidence
     * (SUPPORTING/STRONG, NEVER 'verified'). The derived Twin/gap state is then
     * invalidated so the next read recomputes — the Twin is never mutated here.
     */
    async confirmUploadAnalysis(
      auth: CallerAuth,
      childId: string,
      uploadId: string,
      corrections: readonly ItemCorrection[],
    ) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'manage_child');
      const upload = await uploadStore.getUpload(uploadId);
      if (!upload || upload.childId !== childId) throw new NotFoundError('upload');

      const { analysis, evidenceDrafts, teacherNote } = await uploadIngestion.confirmAnalysis({
        uploadId,
        confirmedByUserId: ctx.userId,
        corrections,
      });

      const evidenceIds: string[] = [];
      for (const d of evidenceDrafts) {
        const id = `ev_upl_${analysis.id}_${d.skillId}_${evidenceIds.length}`;
        await base.ledger.appendEvidence({
          id: id as never,
          childId: asChildId(childId),
          source: d.source,
          occurredAt: d.occurredAt,
          recordedAt: now().toISOString(),
          skillId: d.skillId as never,
          ...(d.problemTypeId ? { problemTypeId: d.problemTypeId as never } : {}),
          result: { ...(d.correct !== null ? { correct: d.correct } : {}) },
          confidenceTier: d.confidenceTier,
          provenance: 'scan',
        });
        evidenceIds.push(id);
      }
      await uploadIngestion.recordResultingEvidence(analysis.id, evidenceIds);
      if (evidenceIds.length > 0) await base.learningState.invalidateDerived(childId);
      analytics.track({
        category: 'upload',
        action: 'evidence_confirmed',
        actorRef: actorRef(ctx.userId),
        metadata: { itemCount: evidenceIds.length },
      });

      return {
        state: analysis.state,
        evidenceRecorded: evidenceIds.length,
        teacherNote,
      };
    },

    /**
     * DELETE /children/:childId/uploads/:uploadId — parent-facing "xoá khỏi
     * danh sách". `uploads` is INSERT-only (a DB trigger rejects UPDATE/DELETE
     * on it — see the evidence-ledger migration), so this can never be a real
     * row delete; it sets `dismissedAt` on the (mutable) analysis row, which
     * `listUploads` then filters out, and best-effort purges the stored bytes
     * to actually shrink storage. Any evidence already produced from a
     * CONFIRMED upload is untouched (append-only) — this is a declutter /
     * "uploaded by mistake" action, not the data-subject deletion workflow.
     */
    async deleteUpload(auth: CallerAuth, childId: string, uploadId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'manage_child');
      const upload = await uploadStore.getUpload(uploadId);
      if (!upload || upload.childId !== childId) throw new NotFoundError('upload');
      const analysis = await uploadStore.getAnalysisByUpload(uploadId);
      if (!analysis) throw new NotFoundError('upload analysis');
      await uploadStore.updateAnalysis(analysis.id, {
        dismissedAt: now().toISOString(),
        dismissedByUserId: ctx.userId,
      });
      try {
        await uploadStorage.remove(upload.storageKey);
      } catch {
        // best-effort — the row is already hidden from the parent's list either way
      }
      return { ok: true as const };
    },

    // ---- PRACTICE LOOP (F8 / F30) — assignment → attempt → evidence ----

    /**
     * PARENT builds a practice assignment from today's plan (legacy
     * reference-library path — LIVE AI generation stays OFF). Persists the plan +
     * the assignment + items.
     */
    async createPracticeAssignment(auth: CallerAuth, childId: string, input: { minutes?: number } = {}) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace === 'STUDENT') {
        // a student may build their own short practice, but only within their own scope
        if (ctx.childScope !== childId) throw new ForbiddenError('student scoped to another child');
      } else {
        await authorizeChild(ctx, childId, 'view_child'); // parent guardian read is enough to assign own child's practice
        if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      }

      // reuse the tested scene (Curriculum Clock estimate + pace + twin + gaps +
      // context + plan) — DB-backed via learningScene, computed for `minutes`.
      const inputs = await resolveChildLearningInputs(pool, base.enrollments, childId, now());
      const scoped = createApi({
        allowLegacyInProduction: true,
        knowledgeBase: kb,
        ledger: base.ledger,
        logger,
        now,
        childProfiles: {
          [childId]: {
            profile: inputs.profile,
            gradeContext: inputs.gradeContext,
            familyUserIds: [],
            ...(inputs.enrollment ? { enrollment: inputs.enrollment } : {}),
          },
        },
      });
      const scene = await scoped._scene(childId);
      const twin = scene.twin;
      const plan =
        scene.plan.kind === 'plan'
          ? scene.plan
          : buildDailyPlan({
              childId: asChildId(childId),
              planDate: now().toISOString().slice(0, 10),
              availableMinutes: input.minutes ?? 20,
              twin,
              gaps: scene.gaps,
              context: scene.context,
              knowledgeBase: kb,
              asOf: now(),
            });

      let seq = 0;
      const newId = () => `${Date.now()}-${(seq += 1)}`;
      const refLib = loadReferenceLibrary();
      const byId = new Map(refLib.map((q) => [q.id, q]));

      let legacy =
        plan.kind === 'plan'
          ? buildAssignmentsForPlan(plan, twin, now().toISOString(), newId)
          : [];

      // ZERO-DATA fallback (Journey 1): the deterministic planner returns
      // `no_plan_needed` for a child it has no signal about. "Hôm nay dạy con gì?"
      // must still have an answer — practice today's ESTIMATED current lesson.
      if (legacy.length === 0) {
        const resolved = scene.context.resolved;
        const active =
          resolved.activeSkillIds.length > 0
            ? [...resolved.activeSkillIds]
            : resolved.lessonId
              ? [...kb.skills.entries()]
                  .filter(([, s]) => s.curriculumNodeId === resolved.lessonId)
                  .map(([id]) => id)
              : [];
        const lessonSkills = new Set(active.map(String));
        let pool2 = refLib.filter((q) => lessonSkills.has(String(q.skillId)));
        if (pool2.length === 0) {
          // the estimated lesson has no authored practice content yet — fall back
          // to conservative grade-level practice (K ≤ K3) for the child's grade.
          pool2 = refLib.filter((q) => {
            const sk = kb.skills.get(q.skillId);
            return (
              sk !== undefined &&
              Number(sk.gradeContext) === Number(inputs.gradeContext) &&
              (q.knowledgeLevel === 'K0' ||
                q.knowledgeLevel === 'K1' ||
                q.knowledgeLevel === 'K2' ||
                q.knowledgeLevel === 'K3')
            );
          });
        }
        if (pool2.length > 0) {
          const picked = pool2.slice(0, 4);
          legacy = [
            {
              id: `asg_${newId()}`,
              childId: asChildId(childId),
              dailyPlanDate: now().toISOString().slice(0, 10),
              mode: 'practice' as const,
              targetSkillIds: [...new Set(picked.map((q) => String(q.skillId)))] as never,
              questionIds: picked.map((q) => q.id),
              createdAt: now().toISOString(),
            },
          ];
        }
      }

      const created: string[] = [];
      await withTransaction(pool, async (client) => {
        const ls = new PgLearningStateStore(client);
        if (plan.kind === 'plan') {
          await ls.savePlan({
            id: cryptoRandom(),
            childId,
            planDate: plan.planDate,
            availableMinutes: input.minutes ?? 20,
            kind: 'plan',
            mix: (plan.mix as Record<string, number>) ?? {},
            plannerVersion: 'exercise-spec.v1',
            createdAt: now().toISOString(),
            items: plan.orderedActions.map((a, i) => ({
              orderIndex: i,
              actionKind: String((a as any).kind ?? 'school'),
              skillId: ((a as any).targetSkillId as string | undefined) ?? null,
              minutes: Number((a as any).minutes ?? 0),
              payload: {},
            })),
          });
        }
        for (const a of legacy) {
          const items = a.questionIds
            .map((qid) => byId.get(qid))
            .filter((q): q is NonNullable<typeof q> => q !== undefined)
            .map((q, i) => ({
              orderIndex: i,
              questionRef: q.id,
              skillId: q.skillId as string,
              problemTypeId: (q.problemTypeId as string | undefined) ?? null,
              knowledgeLevel: kLevelNum(q.knowledgeLevel),
              thinkingLevel: tLevelNum(q.thinkingLevel),
              prompt: { text: q.prompt },
              answerSpec: q.answerSpec,
              hints: [...q.hints],
            }));
          if (items.length === 0) continue;
          const row = await ls.createAssignment({
            childId,
            source: 'LEGACY_PRACTICE',
            assignedByUserId: ctx.userId,
            assignedByRole: ctx.workspace === 'STUDENT' ? 'SYSTEM' : 'PARENT',
            subjectId: null,
            mode: a.mode.toUpperCase(),
            targetSkillIds: a.targetSkillIds as unknown as string[],
            items,
          });
          created.push(row.id);
        }
      });
      if (created.length > 0) {
        analytics.track({
          category: 'practice',
          action: 'practice_started',
          actorRef: actorRef(ctx.userId),
          metadata: { assignmentCount: created.length },
        });
      }
      return { planKind: plan.kind, assignmentIds: created };
    },

    async getChildAssignments(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace === 'STUDENT') {
        if (ctx.childScope !== childId) throw new ForbiddenError('student scoped to another child');
      } else {
        await authorizeChild(ctx, childId, 'view_child');
      }
      await serveLiveWorksheetIfPending(ctx.userId, childId); // doc 69 §5
      const rows = await base.learningState.listAssignmentsForChild(childId);
      return rows.map((a) => ({
        id: a.id,
        status: a.status,
        mode: a.mode,
        targetSkillIds: a.targetSkillIds,
        createdAt: a.createdAt,
        completedAt: a.completedAt,
      }));
    },

    async getAssignmentDetail(auth: CallerAuth, assignmentId: string) {
      const ctx = await deriveContext(auth);
      const full = await base.learningState.getAssignment(assignmentId);
      if (!full) throw new NotFoundError('assignment');
      const childId = full.assignment.childId;
      if (ctx.workspace === 'STUDENT') {
        if (ctx.childScope !== childId) throw new ForbiddenError('student scoped to another child');
      } else {
        await authorizeChild(ctx, childId, 'view_child');
      }
      if (full.assignment.source === 'AI_GENERATED') {
        void recordPilotActivityFor(ctx.userId, childId, ctx.workspace === 'STUDENT' ? 'STUDENT' : 'PARENT', 'worksheet_open', { assignmentId });
      }
      // child-safe item shape — the 5 progressive hints (rungs 1-5, §17) ARE
      // sent, so the ladder can reveal real guidance client-side
      // (packages/practice/src/hint-ladder.ts). The 6th rung — the full
      // worked solution — is deliberately NEVER included here (reference
      // library questions fix `hints` at exactly 6 strings; index 5 is the
      // solution): a child reaching that rung calls
      // getAssignmentItemSolution below, a narrow, separately-authorized
      // reveal so the answer is never sitting in a payload before it's
      // actually earned.
      return {
        id: full.assignment.id,
        status: full.assignment.status,
        mode: full.assignment.mode,
        items: full.items.map((it) => {
          const h = it.hints as readonly string[];
          return {
            id: it.id,
            orderIndex: it.orderIndex,
            prompt: it.prompt,
            answerKind: (it.answerSpec as { kind?: string })?.kind ?? 'exact',
            options: (it.answerSpec as { options?: string[] })?.options ?? null,
            hintCount: it.hints.length,
            hints: h.slice(0, 5),
            hasWorkedSolution: h.length > 5,
          };
        }),
      };
    },

    /**
     * The 6th hint rung ("full_solution") — revealed only on explicit
     * request, once the child's local ladder state has actually reached it.
     * Kept out of getAssignmentDetail's payload entirely (see comment above)
     * so the answer is never present in a response before it's earned.
     */
    async getAssignmentItemSolution(auth: CallerAuth, assignmentId: string, itemId: string) {
      const ctx = await deriveContext(auth);
      const full = await base.learningState.getAssignment(assignmentId);
      if (!full) throw new NotFoundError('assignment');
      const childId = full.assignment.childId;
      if (ctx.workspace === 'STUDENT') {
        if (ctx.childScope !== childId) throw new ForbiddenError('student scoped to another child');
      } else {
        await authorizeChild(ctx, childId, 'view_child');
      }
      const item = full.items.find((it) => it.id === itemId);
      if (!item) throw new NotFoundError('assignment item');
      const h = item.hints as readonly string[];
      return { solution: h[5] ?? null };
    },

    /**
     * STUDENT (own scope) submits practice → persist attempt + answers → verify
     * (deterministic where possible, else honest UNVERIFIED) → write each answer
     * into the append-only evidence ledger → mark COMPLETED → invalidate derived
     * state so the next read recomputes the Twin. The child NEVER sees a
     * correctness claim that was not actually verified.
     */
    async submitPractice(
      auth: CallerAuth,
      assignmentId: string,
      answers: ReadonlyArray<{
        assignmentItemId: string;
        answer: string;
        hintsUsed?: number;
        reasoningText?: string;
        timeSpentSeconds?: number;
      }>,
    ) {
      const ctx = await deriveContext(auth);
      const full = await base.learningState.getAssignment(assignmentId);
      if (!full) throw new NotFoundError('assignment');
      const childId = full.assignment.childId;
      if (ctx.workspace === 'STUDENT') {
        if (ctx.childScope !== childId) throw new ForbiddenError('student scoped to another child');
      } else {
        await authorizeChild(ctx, childId, 'manage_child');
      }
      const itemById = new Map(full.items.map((it) => [it.id, it]));

      const result = await withTransaction(pool, async (client) => {
        const ls = new PgLearningStateStore(client);
        const evSvc = base.ledger; // append-only ledger; PgLedgerStore bound to base pool is fine (INSERT-only)
        const attempt = await ls.startAttempt({ assignmentId, childId });

        const graded = answers.map((a) => {
          const it = itemById.get(a.assignmentItemId);
          const spec = it?.answerSpec as { kind?: string } | undefined;
          const kind = spec?.kind ?? 'exact';
          let correct: boolean | null = null;
          let level = 'UNVERIFIED';
          if (kind === 'exact' || kind === 'numeric' || kind === 'fraction') {
            const v = verifyDeterministic(it!.answerSpec as AnswerSpec, a.answer);
            correct = v.correct;
            level = v.correct !== null ? 'DETERMINISTIC_CORRECTNESS_VERIFIED' : 'FORMAT_VERIFIED';
          } else if (kind === 'choice') {
            const c = (it!.answerSpec as { correct?: string }).correct;
            correct = c !== undefined ? a.answer.trim() === c.trim() : null;
            level = correct !== null ? 'DETERMINISTIC_CORRECTNESS_VERIFIED' : 'FORMAT_VERIFIED';
          } else {
            level = 'AI_CROSSCHECK_REQUIRED'; // reasoning — never claim correctness deterministically
          }
          return { a, it, kind, correct, level };
        });

        await ls.submitAttempt(
          attempt.id,
          graded.map((g) => ({
            assignmentItemId: g.a.assignmentItemId,
            childAnswer: { value: g.a.answer },
            hintsUsed: g.a.hintsUsed ?? 0,
            reasoningText: g.a.reasoningText ?? null,
            timeSpentSeconds: g.a.timeSpentSeconds ?? null,
            verificationLevel: g.level,
            correct: g.correct,
          })),
        );

        // each answer → an append-only Evidence record (feeds the next recompute)
        for (const g of graded) {
          if (!g.it?.skillId) continue;
          await evSvc.appendEvidence({
            id: `ev_${attempt.id}_${g.a.assignmentItemId}` as never,
            childId: asChildId(childId),
            source: 'app_practice',
            occurredAt: now().toISOString(),
            recordedAt: now().toISOString(),
            skillId: g.it.skillId as never,
            ...(g.it.problemTypeId ? { problemTypeId: g.it.problemTypeId as never } : {}),
            result: {
              ...(g.correct !== null ? { correct: g.correct } : {}),
            },
            ...(g.kind === 'reasoning' && g.a.reasoningText
              ? {
                  reasoningQuality:
                    g.a.reasoningText.trim().length >= 60
                      ? ('strong' as const)
                      : g.a.reasoningText.trim().length >= 15
                        ? ('adequate' as const)
                        : ('weak' as const),
                }
              : {}),
            hintDependency:
              (g.it.hints?.length ?? 0) > 0
                ? Math.min(1, (g.a.hintsUsed ?? 0) / (g.it.hints.length || 1))
                : 0,
            ...(g.a.timeSpentSeconds !== undefined ? { timeSpentSeconds: g.a.timeSpentSeconds } : {}),
            confidenceTier: 'B',
            provenance: 'manual',
          });
        }

        await ls.updateAssignmentStatus(assignmentId, 'COMPLETED');
        return {
          attemptId: attempt.id,
          results: graded.map((g) => ({
            assignmentItemId: g.a.assignmentItemId,
            verificationLevel: g.level,
            correct: g.correct,
            // deterministic items have a known answer — surface it so a parent
            // whose child answered in a different form can teach the gap. Never
            // for AI_CROSSCHECK_REQUIRED (no deterministic key there).
            expectedAnswer: g.correct === false ? expectedAnswerText(g.it?.answerSpec) : null,
          })),
        };
      });

      // derived state is now stale — next Twin/gap/plan read recomputes from evidence
      await base.learningState.invalidateDerived(childId);
      analytics.track({
        category: 'practice',
        action: 'practice_completed',
        actorRef: actorRef(ctx.userId),
        metadata: { itemCount: result.results.length },
      });
      void recordPilotActivityFor(ctx.userId, childId, ctx.workspace === 'STUDENT' ? 'STUDENT' : 'PARENT', 'practice_completed', { items: result.results.length, source: full.assignment.source });
      return result;
    },

    /**
     * ADMIN — privacy-safe SHADOW observability (doc 66 §1). No content, no PII.
     */
    async worksheetShadowObservability(ctx: WorkspaceRequestContext, opts?: { sinceIso?: string }) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      const [rollup, failures, review] = await Promise.all([
        shadowRollup(pool, opts?.sinceIso),
        failureBreakdown(pool, opts?.sinceIso),
        reviewQueueRollup(pool),
      ]);
      return { rollup, failures, review, mode: worksheetGen?.mode ?? 'OFF' };
    },

    /** ADMIN / scheduled job — null the short-retention review-queue snapshots. */
    async purgeReviewQueueSnapshots(ctx: WorkspaceRequestContext, retentionDays = 30) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      return { purged: await purgeReviewSnapshots(pool, retentionDays) };
    },

    /**
     * ADMIN reviewer path (doc 67 §D4) — the minimal operational queue for
     * generated items a human must judge (crosscheck UNCERTAIN, no-kernel
     * generation failures, both models failed, non-recoverable content quality).
     * PENDING items carry the short-retention QA snapshot the reviewer needs.
     */
    async reviewQueueListPending(ctx: WorkspaceRequestContext) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      const items = await new PgReviewQueueStore(pool).listPending();
      logger.info('review queue listed', { actor: actorRef(ctx.userId), count: items.length });
      return { items };
    },

    /**
     * ADMIN reviewer decision. `decision` ∈ APPROVED / REJECTED /
     * REGENERATE_REQUESTED. Exactly once per item (the PENDING→resolved guard is
     * in `PgReviewQueueStore`). The `review_queue` row is the audit record:
     * `resolved_by` (pseudonymous reviewer), `resolved_at`, final `state`.
     */
    async reviewQueueResolve(
      ctx: WorkspaceRequestContext,
      itemId: string,
      decision: Exclude<ReviewQueueState, 'PENDING'>,
    ) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      if (!REVIEW_QUEUE_STATES.includes(decision) || (decision as string) === 'PENDING') {
        throw new AuthzError(`invalid review decision "${String(decision)}"`);
      }
      const resolved = await new PgReviewQueueStore(pool).resolve(itemId, decision, actorRef(ctx.userId));
      logger.info('review queue resolved', {
        actor: actorRef(ctx.userId),
        itemId,
        decision,
        reason: resolved.reason,
      });
      return { item: resolved };
    },

    // ---- doc 69: CONTROLLED INTERNAL LIVE — ADMIN control plane ----------

    /** ADMIN — the internal-live dashboard (doc 69 §7). No child content. */
    async internalLiveDashboard(ctx: WorkspaceRequestContext, opts?: { sinceIso?: string }) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      return internalLiveDashboard(pool, opts ?? {});
    },

    /** ADMIN — review-queue operations metrics (doc 69 §10). */
    async internalLiveReviewOps(ctx: WorkspaceRequestContext, opts?: { sinceIso?: string }) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      return reviewQueueOps(pool, opts?.sinceIso);
    },

    /** ADMIN — INTERNAL LIVE cohort (allowlist). */
    async internalLiveCohortList(ctx: WorkspaceRequestContext) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      return { members: await listInternalLiveCohort(pool) };
    },
    async internalLiveCohortAdd(ctx: WorkspaceRequestContext, familyId: string, opts?: { wave?: number; note?: string }) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      const ref = familyRefOf(familyId);
      await addToInternalLiveCohort(pool, ref, { ...(opts ?? {}), actorRef: actorRef(ctx.userId) });
      logger.info('internal-live cohort add', { actor: actorRef(ctx.userId), familyRef: ref });
      return { familyRef: ref };
    },
    async internalLiveCohortRemove(ctx: WorkspaceRequestContext, familyId: string) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      const ref = familyRefOf(familyId);
      await removeFromInternalLiveCohort(pool, ref, actorRef(ctx.userId));
      logger.info('internal-live cohort remove', { actor: actorRef(ctx.userId), familyRef: ref });
      return { familyRef: ref };
    },

    /** ADMIN — kill switch (doc 69 §2). `on:true` halts ALL new paid AI calls, no deploy. */
    async internalLiveKillSwitch(ctx: WorkspaceRequestContext, on: boolean, reason?: string) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      await setKillSwitch(pool, on, {
        reason: reason ?? (on ? 'manual kill' : 'manual clear'),
        source: 'manual',
        actorRef: actorRef(ctx.userId),
      });
      logger.warn('internal-live kill switch', { actor: actorRef(ctx.userId), on, reason });
      return resolveKillSwitch(pool);
    },
    async internalLiveKillSwitchStatus(ctx: WorkspaceRequestContext) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      return resolveKillSwitch(pool);
    },

    /** ADMIN — run the safety scan; activates the kill switch on any CRITICAL condition (doc 69 §4). */
    async internalLiveSafetyScan(ctx: WorkspaceRequestContext, opts?: { sinceIso?: string; enforce?: boolean }) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      if (opts?.enforce === false) return { scan: await scanInternalLiveSafety(pool, opts ?? {}), tripped: false };
      return enforceSafetyAutoStop(pool, opts ?? {});
    },

    /** ADMIN — Wave-1 QA sampling (doc 69 §8). List is metadata-only; read is access-logged. */
    async internalLiveQaList(ctx: WorkspaceRequestContext, limit?: number) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      return { samples: await listQaSamples(pool, limit ?? 50) };
    },
    async internalLiveQaRead(ctx: WorkspaceRequestContext, id: string) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      const sample = await readQaSample(pool, id, actorRef(ctx.userId));
      if (!sample) throw new NotFoundError('qa sample (missing or purged)');
      logger.info('internal-live qa sample read', { actor: actorRef(ctx.userId), id });
      return { sample };
    },

    /** ADMIN / cron — retention + TTL sweeps (doc 69 §8). */
    async internalLiveMaintenance(ctx: WorkspaceRequestContext) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      const qaPurged = await purgeExpiredQaSamples(pool);
      const servingPurged = await purgeStaleServingIntents(pool);
      return { qaSnapshotsPurged: qaPurged, servingIntentsExpired: servingPurged };
    },

    // ---- doc 70: SMALL FAMILY PILOT --------------------------------------

    /** ADMIN — add a family to the PILOT cohort (LIVE + consent-required). */
    async pilotFamilyAdd(ctx: WorkspaceRequestContext, familyId: string, note?: string) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      const ref = familyRefOf(familyId);
      await addPilotFamily(pool, ref, { ...(note ? { note } : {}), actorRef: actorRef(ctx.userId) });
      logger.info('pilot family add', { actor: actorRef(ctx.userId), familyRef: ref });
      return { familyRef: ref };
    },
    async pilotFamilyList(ctx: WorkspaceRequestContext) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      return { families: await listPilotFamilies(pool) };
    },
    async pilotDashboard(ctx: WorkspaceRequestContext, opts?: { sinceIso?: string }) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      return pilotDashboard(pool, opts ?? {});
    },
    async pilotFeedbackRollup(ctx: WorkspaceRequestContext, opts?: { sinceIso?: string }) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      return feedbackRollup(pool, opts?.sinceIso);
    },

    /**
     * ADMIN — "why isn't this child getting an AI worksheet?" self-service
     * diagnostic (doc 70). Reads the exact same decision points the serving
     * path reads (cohort / consent / kill switch / budget / config), plus
     * whether this deployment is even wired for a durable cross-process queue —
     * a `worker` Railway service can only see jobs written to Postgres; if
     * `WORKSHEET_QUEUE` isn't `durable` on the enqueuing side, jobs never
     * leave that process and nothing here will ever error. No child content.
     */
    async pilotDiagnose(ctx: WorkspaceRequestContext, childId: string) {
      if (ctx.workspace !== 'ADMIN') throw new AuthzError('admin only');
      const row = (await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [childId])).rows[0];
      if (!row) throw new NotFoundError('child');
      const fref = familyRefOf(row.family_id);
      const [effective, inCohort, requiresConsent, consent, kill, budget] = await Promise.all([
        resolveEffectiveGenerationMode(pool, process.env, fref),
        isInInternalLiveCohort(pool, fref),
        familyRequiresConsent(pool, fref),
        hasPilotConsent(pool, childId),
        resolveKillSwitch(pool, process.env),
        internalLiveBudgetGate(pool, process.env, 'generation', 0.05),
      ]);
      const jobStats = (
        await pool.query<{ state: string; n: string }>(
          `SELECT state, count(*)::int n FROM worksheet_jobs WHERE child_ref = $1 GROUP BY state`,
          [childRefOf(childId)],
        )
      ).rows;
      const runStats = (
        await pool.query<{ mode: string; n: string }>(
          `SELECT mode, count(*)::int n FROM worksheet_generation_runs WHERE child_ref = $1 GROUP BY mode`,
          [childRefOf(childId)],
        )
      ).rows;
      const queue = worksheetGen?.queue as { enqueueDurable?: unknown } | undefined;
      return {
        familyRef: fref,
        childRef: childRefOf(childId),
        deployment: {
          worksheetGenerationConfigured: worksheetGen !== null,
          queueIsDurable: typeof queue?.enqueueDurable === 'function',
          env: {
            AI_GENERATION_MODE: process.env.AI_GENERATION_MODE ?? null,
            AI_CROSSCHECK_MODE: process.env.AI_CROSSCHECK_MODE ?? null,
            WORKSHEET_QUEUE: process.env.WORKSHEET_QUEUE ?? null,
            hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
          },
        },
        cohort: { inCohort, requiresConsent, hasConsent: consent },
        effectiveMode: effective, // what a real getToday call would compute right now
        killSwitch: kill,
        budgetGate: budget,
        jobsByState: Object.fromEntries(jobStats.map((r) => [r.state, Number(r.n)])),
        runsByMode: Object.fromEntries(runStats.map((r) => [r.mode, Number(r.n)])),
      };
    },

    /** PARENT — record guardian consent for a child to join the pilot (doc 70 §4). */
    async recordPilotConsent(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'manage_child');
      const { consentId } = await recordPilotConsentRow(pool, { childId, grantedByUserId: ctx.userId });
      logger.info('pilot consent recorded', { actor: actorRef(ctx.userId), consentId });
      return { consentId, recorded: true };
    },
    async withdrawPilotConsent(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'manage_child');
      const n = await withdrawPilotConsentRow(pool, childId, ctx.userId);
      return { withdrawn: n };
    },
    async pilotConsentStatus(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      await authorizeChild(ctx, childId, 'view_child');
      return { hasConsent: await hasPilotConsent(pool, childId) };
    },

    /** PARENT — lightweight feedback on today's worksheet / plan (doc 70 §5).
     *  Append-only; NEVER auto-alters mastery — may create a hypothesis only. */
    async submitParentFeedback(
      auth: CallerAuth,
      childId: string,
      input: { verdict: FeedbackVerdict; note?: string; assignmentId?: string },
    ) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      if (!FEEDBACK_VERDICTS.includes(input.verdict)) throw new AuthzError(`invalid feedback verdict "${String(input.verdict)}"`);
      if (input.assignmentId) {
        const a = await base.learningState.getAssignment(input.assignmentId);
        if (a && a.assignment.childId !== childId) throw new ForbiddenError('assignment belongs to another child');
      }
      const famId = await familyIdFor(ctx.userId);
      const res = await recordParentFeedback(pool, {
        childRef: childRefOf(childId),
        familyRef: famId ? familyRefOf(famId) : null,
        assignmentId: input.assignmentId ?? null,
        verdict: input.verdict,
        note: input.note ?? null,
      });
      void recordPilotActivityFor(ctx.userId, childId, 'PARENT', 'feedback_submitted', { verdict: input.verdict });
      analytics.track({ category: 'practice', action: 'parent_feedback', actorRef: actorRef(ctx.userId), metadata: { verdict: input.verdict } });
      return { feedbackId: res.feedbackId, hypothesis: res.hypothesis };
    },

    // exposed for tests / transports
    _deriveContext: deriveContext,
    _services: base,
    _worksheetGeneration: worksheetGen,
    _effectiveModeFor: effectiveModeFor,
    _maybeEnqueueLiveWorksheet: maybeEnqueueLiveWorksheet,
    _serveLiveWorksheetIfPending: serveLiveWorksheetIfPending,
  };

  function auditRow(
    ctx: WorkspaceRequestContext,
    eventType: import('@copilot/domain').AuditEventType,
    subjectId: string,
    childId: string,
    payload: Record<string, unknown>,
  ): import('@copilot/domain').AuditEventRecord {
    return {
      id: cryptoRandom(),
      actorUserId: ctx.userId,
      actorWorkspace: ctx.workspace,
      eventType,
      subjectType: 'teacher_child_links',
      subjectId,
      childId,
      payload,
      createdAt: now().toISOString(),
    };
  }
}

function cryptoRandom(): string {
  return globalThis.crypto?.randomUUID?.() ?? `evt-${Math.random().toString(36).slice(2)}`;
}


function kLevelNum(k: string): number {
  return Number(String(k).replace(/[^0-9]/g, '')) || 2;
}
function tLevelNum(t: string): number {
  return Number(String(t).replace(/[^0-9]/g, '')) || 2;
}

/**
 * Narrow deterministic check for `exact` / `numeric` / `fraction` answer specs.
 * Returns `{ correct: null }` when the child's answer is well-formed but the spec
 * carries no comparable value — never guesses.
 */
function expectedAnswerText(spec: unknown): string | null {
  const s = spec as
    | { kind?: string; value?: unknown; numerator?: number; denominator?: number; correct?: string }
    | undefined;
  if (!s) return null;
  if (s.kind === 'exact') return typeof s.value === 'string' ? s.value : null;
  if (s.kind === 'numeric') return s.value != null ? String(s.value) : null;
  if (s.kind === 'fraction' && s.numerator != null && s.denominator != null) {
    return `${s.numerator}/${s.denominator}`;
  }
  if (s.kind === 'choice') return s.correct ?? null;
  return null;
}

function verifyDeterministic(spec: AnswerSpec, raw: string): { correct: boolean | null } {
  const a = raw.trim().replace(/\s+/g, '').replace('−', '-').replace(',', '.');
  if (spec.kind === 'exact') {
    return { correct: a.toLowerCase() === spec.value.trim().replace(/\s+/g, '').toLowerCase() };
  }
  if (spec.kind === 'numeric') {
    const n = Number(a);
    if (!Number.isFinite(n)) return { correct: null };
    return { correct: Math.abs(n - spec.value) <= (spec.tolerance ?? 0) };
  }
  if (spec.kind === 'fraction') {
    const m = /^(-?\d+)\/(-?\d+)$/.exec(a);
    if (!m) {
      const n = Number(a);
      if (Number.isFinite(n) && spec.denominator !== 0) {
        return { correct: Math.abs(n - spec.numerator / spec.denominator) < 1e-9 };
      }
      return { correct: null };
    }
    const num2 = Number(m[1]);
    const den = Number(m[2]);
    if (den === 0 || spec.denominator === 0) return { correct: null };
    return { correct: num2 * spec.denominator === spec.numerator * den };
  }
  return { correct: null };
}

export { AuthzError, NotFoundError };
