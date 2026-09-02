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
import { loadKnowledgeBase, type KnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningTwin } from '@copilot/learning-twin';
import { buildDailyPlan } from '@copilot/planning';
import { buildAssignmentsForPlan } from '@copilot/practice';
import { createLogger, type Logger } from '@copilot/observability';
import { asChildId, type AnswerSpec } from '@copilot/domain';
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
    });
    return { scoped, inputs };
  }

  const parentDelegateCtx = (userId: string): RequestContext => ({
    userId,
    role: 'admin', // authorization already enforced above; 'admin' bypasses the legacy family check
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
      return meDto(r);
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
      return { school, class: cls, transitions };
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
        const { scoped } = await learningScene(childId);
        return scoped.childToday({ userId: ctx.userId, role: 'child', childScope: childId }, childId);
      }
      await authorizeChild(ctx, childId, 'view_child');
      const { scoped } = await learningScene(childId);
      return scoped.childToday({ userId: 'preview', role: 'child', childScope: childId }, childId);
    },

    /**
     * GET /children/:childId/home — the hero screen ("Hôm nay dạy con gì?").
     * DB-authorized, then the tested Parent projection. Also persists a
     * write-through snapshot of the computed twin/gaps for fast subsequent reads.
     */
    async getParentHome(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const { scoped } = await learningScene(childId);
      const view = await scoped.parentHome(parentDelegateCtx(ctx.userId), childId);
      // write-through cache (best-effort, never blocks the response)
      try {
        const scene = await scoped._scene(childId);
        const evCount = (await base.ledger.listEvidence(asChildId(childId))).length;
        await base.learningState.putSnapshot({
          childId,
          kind: 'TWIN',
          state: scene.twin as unknown,
          stateVersion: 'twin.v1',
          evidenceCount: evCount,
          contentHash: snapshotHash(scene.twin),
          provenance: { computedBy: 'getParentHome' },
          computedAt: now().toISOString(),
        });
      } catch {
        /* cache write is best-effort */
      }
      return view;
    },

    /** GET /children/:childId/progress */
    async getParentProgress(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const { scoped } = await learningScene(childId);
      return scoped.parentProgress(parentDelegateCtx(ctx.userId), childId);
    },

    /** GET /children/:childId/gaps/:gapId */
    async getParentGapDetail(auth: CallerAuth, childId: string, gapId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'PARENT') throw new ForbiddenError('PARENT workspace required');
      await authorizeChild(ctx, childId, 'view_child');
      const { scoped } = await learningScene(childId);
      return scoped.parentGapDetail(parentDelegateCtx(ctx.userId), childId, gapId);
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
      const out: Array<{ childId: string; displayName: string; subjectId: string | null }> = [];
      for (const l of links) {
        const row = (await pool.query(`SELECT display_name FROM child_profiles WHERE id = $1`, [l.childId]))
          .rows[0] as any;
        if (row) out.push({ childId: l.childId, displayName: row.display_name, subjectId: l.subjectId });
      }
      return out;
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
      const { inputs } = await learningScene(childId);
      const evidence = await base.ledger.listEvidence(asChildId(childId));
      const twin = buildLearningTwin({
        childId: asChildId(childId),
        gradeContext: inputs.gradeContext,
        evidence,
        knowledgeBase: kb,
        asOf: now(),
      });
      // redacted — mastery band words only, no scores, no evidence, no behaviour
      const skills = [...twin.skillMastery.entries()]
        .slice(0, 12)
        .map(([skillId, s]) => ({
          skillId,
          band: s.mastery >= 75 ? 'vững' : s.mastery >= 50 ? 'đang_ổn_định' : 'cần_củng_cố',
        }));
      return { childId, skills };
    },

    async teacherGetGaps(auth: CallerAuth, childId: string, subjectId?: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace !== 'TEACHER') throw new ForbiddenError('TEACHER workspace required');
      await authorizeChild(ctx, childId, 'view_selected_gaps', subjectId);
      const { inputs } = await learningScene(childId);
      const evidence = await base.ledger.listEvidence(asChildId(childId));
      const twin = buildLearningTwin({
        childId: asChildId(childId),
        gradeContext: inputs.gradeContext,
        evidence,
        knowledgeBase: kb,
        asOf: now(),
      });
      const gaps = runGapEngine({
        childId: asChildId(childId),
        gradeContext: inputs.gradeContext,
        twin,
        evidence,
        knowledgeBase: kb,
        asOf: now(),
      });
      return {
        childId,
        gaps: gaps.gaps
          .slice(0, 12)
          .map((g) => ({ skillId: g.targetSkillId, type: g.type, lifecycleState: g.lifecycleState })),
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
      const { scoped } = await learningScene(ctx.childScope);
      return scoped.childToday(
        { userId: ctx.userId, role: 'child', childScope: ctx.childScope },
        ctx.childScope,
      );
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
      const inputs = await resolveChildLearningInputs(pool, base.enrollments, childId, now());
      const evidence = await base.ledger.listEvidence(asChildId(childId));
      const twin = buildLearningTwin({ childId: asChildId(childId), gradeContext: inputs.gradeContext, evidence, knowledgeBase: kb, asOf: now() });
      const gaps = runGapEngine({ childId: asChildId(childId), gradeContext: inputs.gradeContext, twin, evidence, knowledgeBase: kb, asOf: now() });
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
      const inputs = await resolveChildLearningInputs(pool, base.enrollments, childId, now());
      const evidence = await base.ledger.listEvidence(asChildId(childId));
      const twin = buildLearningTwin({ childId: asChildId(childId), gradeContext: inputs.gradeContext, evidence, knowledgeBase: kb, asOf: now() });
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
      return { planKind: plan.kind, assignmentIds: created };
    },

    async getChildAssignments(auth: CallerAuth, childId: string) {
      const ctx = await deriveContext(auth);
      if (ctx.workspace === 'STUDENT') {
        if (ctx.childScope !== childId) throw new ForbiddenError('student scoped to another child');
      } else {
        await authorizeChild(ctx, childId, 'view_child');
      }
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
      // child-safe item shape — no worked solution, hint ladder is progressive client-side
      return {
        id: full.assignment.id,
        status: full.assignment.status,
        mode: full.assignment.mode,
        items: full.items.map((it) => ({
          id: it.id,
          orderIndex: it.orderIndex,
          prompt: it.prompt,
          answerKind: (it.answerSpec as { kind?: string })?.kind ?? 'exact',
          options: (it.answerSpec as { options?: string[] })?.options ?? null,
          hintCount: it.hints.length,
        })),
      };
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
          })),
        };
      });

      // derived state is now stale — next Twin/gap/plan read recomputes from evidence
      await base.learningState.invalidateDerived(childId);
      return result;
    },

    // exposed for tests / transports
    _deriveContext: deriveContext,
    _services: base,
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
