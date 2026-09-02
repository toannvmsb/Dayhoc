import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from './auth-adapter.js';
import { AuthorizationService } from './authorization-service.js';
import { InMemoryClassContextReader } from './class-context.js';
import { FamilyService } from './family-service.js';
import { IdentityService } from './identity-service.js';
import { PermissionService } from './permission-service.js';
import { RelationshipService } from './relationship-service.js';
import { InMemoryRelationshipStore } from './relationship-store.js';
import { InMemoryIdentityStore } from './store.js';
import { AuthorizationError, ConflictError } from './errors.js';

const MATH = 'subject-math';

function makeHarness() {
  const identityStore = new InMemoryIdentityStore();
  const relStore = new InMemoryRelationshipStore();
  const classContext = new InMemoryClassContextReader();
  const auth = new InMemoryAuthAdapter();
  let seq = 0;
  const newId = () => `r_${(seq += 1).toString().padStart(3, '0')}`;
  const now = () => new Date('2027-02-01T00:00:00.000Z');

  const identity = new IdentityService({ store: identityStore, auth, newId, now });
  const family = new FamilyService({ store: identityStore, newId, now });
  const permissions = new PermissionService({ store: relStore, classContext, newId, now });
  const relationships = new RelationshipService({
    store: relStore,
    identityStore,
    permissions,
    newId,
    now,
    requestExpiryDays: 14,
  });
  const authorization = new AuthorizationService({
    identityStore,
    relationshipStore: relStore,
    permissions,
    now,
  });
  return { identityStore, relStore, classContext, identity, family, permissions, relationships, authorization };
}

async function setupFamily(h: ReturnType<typeof makeHarness>) {
  const parent = (
    await h.identity.register({ email: 'p@x.com', password: 'supersecret', intendedRole: 'PARENT' })
  ).user.id;
  const familyId = await h.family.createFamily(parent);
  const childId = await h.family.createChild({
    familyId,
    creatorUserId: parent,
    displayName: 'Bé An',
    schoolGrade: 7,
  });
  const teacher = (
    await h.identity.register({ email: 't@x.com', password: 'supersecret', intendedRole: 'TEACHER' })
  ).user.id;
  return { parent, familyId, childId, teacher };
}

describe('I4 — relationships & permissions', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it('parent-initiated: request → teacher accepts → scoped grants active', async () => {
    const { parent, childId, teacher } = await setupFamily(h);
    const req = await h.relationships.createRequest({
      requesterUserId: parent,
      requesterRole: 'PARENT',
      relationshipKind: 'TEACHER_CHILD',
      targetType: 'CHILD',
      targetChildId: childId,
      targetUserId: teacher,
      subjectId: MATH,
      proposedPermissions: ['SUBMIT_CURRENT_LESSON', 'VIEW_ASSIGNMENT_COMPLETION'],
    });
    expect(req.status).toBe('PENDING');

    await h.relationships.acceptRequest(req.id, teacher);
    expect((await h.permissions.can(teacher, childId, 'SUBMIT_CURRENT_LESSON', MATH)).allowed).toBe(true);
    expect((await h.permissions.can(teacher, childId, 'VIEW_SELECTED_GAPS', MATH)).allowed).toBe(false);
  });

  it('teacher-initiated Child request: ZERO access until an authorised guardian accepts (R-2)', async () => {
    const { parent, childId, teacher } = await setupFamily(h);
    const req = await h.relationships.createRequest({
      requesterUserId: teacher,
      requesterRole: 'TEACHER',
      relationshipKind: 'TEACHER_CHILD',
      targetType: 'CHILD',
      targetChildId: childId,
      subjectId: MATH,
      proposedPermissions: ['VIEW_SELECTED_MASTERY', 'SUBMIT_CURRENT_LESSON'],
      discoveryMethod: 'INVITE_CODE',
    });

    // BEFORE acceptance — nothing
    expect(await h.relationships.listChildRelationships(childId)).toHaveLength(0);
    for (const code of ['VIEW_SELECTED_MASTERY', 'SUBMIT_CURRENT_LESSON', 'VIEW_CLASS_CONTEXT'] as const) {
      expect((await h.permissions.can(teacher, childId, code, MATH)).allowed).toBe(false);
    }
    // teacher cannot accept their own request
    await expect(h.relationships.acceptRequest(req.id, teacher)).rejects.toBeInstanceOf(AuthorizationError);

    // guardian accepts a SUBSET
    await h.relationships.acceptRequest(req.id, parent, ['SUBMIT_CURRENT_LESSON']);
    expect((await h.permissions.can(teacher, childId, 'SUBMIT_CURRENT_LESSON', MATH)).allowed).toBe(true);
    // proposed-but-not-approved code stays off
    expect((await h.permissions.can(teacher, childId, 'VIEW_SELECTED_MASTERY', MATH)).allowed).toBe(false);
    const links = await h.relationships.listChildRelationships(childId);
    expect(links[0]!.acceptedByParentUserId).toBe(parent);
  });

  it('guardian rejects a teacher-initiated request → no link, all denied', async () => {
    const { parent, childId, teacher } = await setupFamily(h);
    const req = await h.relationships.createRequest({
      requesterUserId: teacher,
      requesterRole: 'TEACHER',
      relationshipKind: 'TEACHER_CHILD',
      targetType: 'CHILD',
      targetChildId: childId,
      subjectId: MATH,
      proposedPermissions: ['SUBMIT_CURRENT_LESSON'],
    });
    await h.relationships.rejectRequest(req.id, parent);
    expect((await h.relationships.listChildRelationships(childId))).toHaveLength(0);
    expect((await h.permissions.can(teacher, childId, 'SUBMIT_CURRENT_LESSON', MATH)).allowed).toBe(false);
  });

  it('revoke stops future access immediately; history is retained', async () => {
    const { parent, childId, teacher } = await setupFamily(h);
    const req = await h.relationships.createRequest({
      requesterUserId: parent,
      requesterRole: 'PARENT',
      relationshipKind: 'TEACHER_CHILD',
      targetType: 'CHILD',
      targetChildId: childId,
      targetUserId: teacher,
      subjectId: MATH,
      proposedPermissions: ['SUBMIT_CURRENT_LESSON'],
    });
    const { link } = await h.relationships.acceptRequest(req.id, teacher);
    expect((await h.permissions.can(teacher, childId, 'SUBMIT_CURRENT_LESSON', MATH)).allowed).toBe(true);

    await h.relationships.revokeTeacherChildLink(link.id, parent);
    expect((await h.permissions.can(teacher, childId, 'SUBMIT_CURRENT_LESSON', MATH)).allowed).toBe(false);
    const links = await h.relationships.listChildRelationships(childId);
    expect(links[0]!.status).toBe('REVOKED'); // still there — history retained
  });

  it('duplicate PENDING request returns the existing one (idempotent)', async () => {
    const { parent, childId, teacher } = await setupFamily(h);
    const a = await h.relationships.createRequest({
      requesterUserId: parent,
      requesterRole: 'PARENT',
      relationshipKind: 'TEACHER_CHILD',
      targetType: 'CHILD',
      targetChildId: childId,
      targetUserId: teacher,
      subjectId: MATH,
    });
    const b = await h.relationships.createRequest({
      requesterUserId: parent,
      requesterRole: 'PARENT',
      relationshipKind: 'TEACHER_CHILD',
      targetType: 'CHILD',
      targetChildId: childId,
      targetUserId: teacher,
      subjectId: MATH,
    });
    expect(b.id).toBe(a.id);
  });

  it('simultaneous cross-invitations: first accept wins, the other is superseded', async () => {
    const { parent, childId, teacher } = await setupFamily(h);
    const parentReq = await h.relationships.createRequest({
      requesterUserId: parent,
      requesterRole: 'PARENT',
      relationshipKind: 'TEACHER_CHILD',
      targetType: 'CHILD',
      targetChildId: childId,
      targetUserId: teacher,
      subjectId: MATH,
      proposedPermissions: ['SUBMIT_CURRENT_LESSON'],
    });
    const teacherReq = await h.relationships.createRequest({
      requesterUserId: teacher,
      requesterRole: 'TEACHER',
      relationshipKind: 'TEACHER_CHILD',
      targetType: 'CHILD',
      targetChildId: childId,
      subjectId: MATH,
      proposedPermissions: ['SUBMIT_CURRENT_LESSON'],
    });
    await h.relationships.acceptRequest(parentReq.id, teacher);
    // the teacher's own request now supersedes to CANCELLED on accept attempt by the guardian
    const res = await h.relationships.acceptRequest(teacherReq.id, parent);
    expect(res.request.status).toBe('CANCELLED');
    expect(await h.relationships.listChildRelationships(childId)).toHaveLength(1);
  });

  it('an expired request cannot be accepted', async () => {
    const { parent, childId, teacher } = await setupFamily(h);
    // build a harness whose clock advances past expiry
    const req = await h.relationships.createRequest({
      requesterUserId: parent,
      requesterRole: 'PARENT',
      relationshipKind: 'TEACHER_CHILD',
      targetType: 'CHILD',
      targetChildId: childId,
      targetUserId: teacher,
      subjectId: MATH,
    });
    // re-wire a relationships service with a later clock
    const late = new RelationshipService({
      store: h.relStore,
      identityStore: h.identityStore,
      permissions: h.permissions,
      now: () => new Date('2027-03-15T00:00:00Z'), // > 14 days later
    });
    await expect(late.acceptRequest(req.id, teacher)).rejects.toBeInstanceOf(ConflictError);
  });

  it('Teacher–Parent relationship grants NO child-data access (R-3), only MESSAGE_PARENT', async () => {
    const { parent, childId, teacher } = await setupFamily(h);
    const req = await h.relationships.createRequest({
      requesterUserId: teacher,
      requesterRole: 'TEACHER',
      relationshipKind: 'TEACHER_PARENT',
      targetType: 'PARENT',
      targetUserId: parent,
      targetChildId: childId,
    });
    await h.relationships.acceptRequest(req.id, parent);
    for (const code of ['VIEW_CLASS_CONTEXT', 'SUBMIT_CURRENT_LESSON', 'VIEW_LEARNING_TWIN_SUMMARY'] as const) {
      expect((await h.permissions.can(teacher, childId, code, MATH)).allowed).toBe(false);
    }
  });

  describe('class-context vs child-specific writes + privacy mode', () => {
    let ids: Awaited<ReturnType<typeof setupFamily>>;
    beforeEach(async () => {
      ids = await setupFamily(h);
      // teacher has an ACTIVE class assignment for MATH; child is ACTIVE PRIMARY there
      h.classContext.setActiveAssignment(ids.teacher, 'class-7c0', MATH);
      h.classContext.setPrimaryEnrollment(ids.childId, 'class-7c0', 'enr-1', 'LINKED_SHARED');
      // a link exists with only a CLASS_ASSIGNMENT-sourced grant for a class-context code
      const req = await h.relationships.createRequest({
        requesterUserId: ids.parent,
        requesterRole: 'PARENT',
        relationshipKind: 'TEACHER_CHILD',
        targetType: 'CHILD',
        targetChildId: ids.childId,
        targetUserId: ids.teacher,
        subjectId: MATH,
        accessSource: 'CLASS_ASSIGNMENT',
        proposedPermissions: ['SUBMIT_CURRENT_LESSON', 'VIEW_CLASS_CONTEXT'],
      });
      await h.relationships.acceptRequest(req.id, ids.teacher);
    });

    it('class-context write is allowed when all six conditions hold', async () => {
      expect((await h.permissions.can(ids.teacher, ids.childId, 'SUBMIT_CURRENT_LESSON', MATH)).allowed).toBe(true);
    });

    it('the same class link CANNOT submit a child-specific skill assessment', async () => {
      const link = (await h.relationships.listChildRelationships(ids.childId))[0]!;
      // no grant at all → denied
      expect((await h.permissions.can(ids.teacher, ids.childId, 'SUBMIT_SKILL_ASSESSMENT', MATH)).allowed).toBe(false);
      // a CLASS_ASSIGNMENT grant for a child-specific code is rejected outright
      await expect(
        h.permissions.grant({
          linkId: link.id,
          linkType: 'TEACHER_CHILD',
          code: 'SUBMIT_SKILL_ASSESSMENT',
          subjectId: MATH,
          accessSource: 'CLASS_ASSIGNMENT',
          grantedByUserId: ids.parent,
        }),
      ).rejects.toThrow();
      // only an explicit PARENT_DIRECT grant unlocks it
      await h.permissions.grant({
        linkId: link.id,
        linkType: 'TEACHER_CHILD',
        code: 'SUBMIT_SKILL_ASSESSMENT',
        subjectId: MATH,
        accessSource: 'PARENT_DIRECT',
        grantedByUserId: ids.parent,
      });
      expect((await h.permissions.can(ids.teacher, ids.childId, 'SUBMIT_SKILL_ASSESSMENT', MATH)).allowed).toBe(true);
    });

    it('a CHILD_SPECIFIC_WRITE grant sourced only from CLASS_ASSIGNMENT is denied by can()', async () => {
      // simulate a mis-provisioned grant that slipped past the grant() guard
      const link = (await h.relationships.listChildRelationships(ids.childId))[0]!;
      await h.relStore.insertGrant({
        id: 'bad-grant-1',
        subjectLinkType: 'TEACHER_CHILD',
        subjectLinkId: link.id,
        permissionCode: 'SUBMIT_LEARNING_OBSERVATION',
        subjectId: MATH as never,
        accessSource: 'CLASS_ASSIGNMENT',
        grantedByUserId: ids.parent,
        status: 'ACTIVE',
        grantedAt: '2027-02-01T00:00:00Z',
        revokedAt: null,
      });
      const d = await h.permissions.can(ids.teacher, ids.childId, 'SUBMIT_LEARNING_OBSERVATION', MATH);
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain('PARENT_DIRECT');
    });

    it('a classroom assignment never yields a sensitive Twin read', async () => {
      for (const code of ['VIEW_SELECTED_GAPS', 'VIEW_LEARNING_TWIN_SUMMARY'] as const) {
        expect((await h.permissions.can(ids.teacher, ids.childId, code, MATH)).allowed).toBe(false);
      }
    });

    it('privacy_mode other than LINKED_SHARED denies the class-derived write', async () => {
      h.classContext.setPrimaryEnrollment(ids.childId, 'class-7c0', 'enr-1', 'LINKED_PRIVATE');
      const d = await h.permissions.can(ids.teacher, ids.childId, 'SUBMIT_CURRENT_LESSON', MATH);
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain('LINKED_SHARED');
    });

    it('subject scope — a grant scoped to MATH does not authorise another subject', async () => {
      const d = await h.permissions.can(ids.teacher, ids.childId, 'SUBMIT_CURRENT_LESSON', 'subject-vietnamese');
      expect(d.allowed).toBe(false);
    });
  });
});

describe('I4 — AuthorizationService (server-side gate)', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it('rejects a workspace the user does not hold', async () => {
    const { parent, childId } = await setupFamily(h);
    await expect(
      h.authorization.authorize({ userId: parent, workspace: 'ADMIN' }, { kind: 'child', childId }, 'view_child'),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('a guardian may read their child; a stranger cannot', async () => {
    const { parent, childId } = await setupFamily(h);
    await expect(
      h.authorization.authorize({ userId: parent, workspace: 'PARENT' }, { kind: 'child', childId }, 'view_child'),
    ).resolves.toBeUndefined();

    const stranger = (
      await h.identity.register({ email: 'z@x.com', password: 'supersecret', intendedRole: 'PARENT' })
    ).user.id;
    await expect(
      h.authorization.authorize({ userId: stranger, workspace: 'PARENT' }, { kind: 'child', childId }, 'view_child'),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('a STUDENT token cannot reach another child and is limited to child-safe actions', async () => {
    const { childId } = await setupFamily(h);
    const student = (
      await h.identity.register({ email: 's@x.com', password: 'supersecret', intendedRole: 'STUDENT' })
    ).user.id;
    await expect(
      h.authorization.authorize(
        { userId: student, workspace: 'STUDENT', childScope: 'another-child' },
        { kind: 'child', childId },
        'view_today',
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      h.authorization.authorize(
        { userId: student, workspace: 'STUDENT', childScope: childId },
        { kind: 'child', childId },
        'view_selected_gaps',
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      h.authorization.authorize(
        { userId: student, workspace: 'STUDENT', childScope: childId },
        { kind: 'child', childId },
        'view_today',
      ),
    ).resolves.toBeUndefined();
  });

  it('a teacher with a PENDING relationship gets denied; an audit row is written', async () => {
    const { childId, teacher } = await setupFamily(h);
    await h.relationships.createRequest({
      requesterUserId: teacher,
      requesterRole: 'TEACHER',
      relationshipKind: 'TEACHER_CHILD',
      targetType: 'CHILD',
      targetChildId: childId,
      subjectId: MATH,
      proposedPermissions: ['SUBMIT_CURRENT_LESSON'],
    });
    await expect(
      h.authorization.authorize(
        { userId: teacher, workspace: 'TEACHER' },
        { kind: 'child', childId, subjectId: MATH },
        'submit_current_lesson',
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const denials = await h.relStore.listAuditEvents({ childId, eventType: 'CHILD_DATA_ACCESS_DENIED' });
    expect(denials.length).toBeGreaterThan(0);
  });

  it('ADMIN has no child-data path', async () => {
    const { childId } = await setupFamily(h);
    const admin = (
      await h.identity.register({ email: 'a@x.com', password: 'supersecret', intendedRole: 'ADMIN' })
    ).user.id;
    await expect(
      h.authorization.authorize({ userId: admin, workspace: 'ADMIN' }, { kind: 'child', childId }, 'view_child'),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
