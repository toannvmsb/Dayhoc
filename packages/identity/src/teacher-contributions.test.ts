import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from './auth-adapter.js';
import { InMemoryClassContextReader } from './class-context.js';
import { FamilyService } from './family-service.js';
import { IdentityService } from './identity-service.js';
import { PermissionService } from './permission-service.js';
import { RelationshipService } from './relationship-service.js';
import { InMemoryRelationshipStore } from './relationship-store.js';
import { InMemoryIdentityStore } from './store.js';
import {
  InMemoryTeacherContributionSink,
  TeacherContributionService,
} from './teacher-contribution-service.js';
import { AuthorizationError } from './errors.js';

const MATH = 'subject-math';
const VN = 'subject-vietnamese';

function makeHarness() {
  const identityStore = new InMemoryIdentityStore();
  const relStore = new InMemoryRelationshipStore();
  const classContext = new InMemoryClassContextReader();
  const sink = new InMemoryTeacherContributionSink();
  const auth = new InMemoryAuthAdapter();
  let seq = 0;
  const newId = () => `c_${(seq += 1).toString().padStart(3, '0')}`;
  const now = () => new Date('2027-02-10T00:00:00.000Z');

  const identity = new IdentityService({ store: identityStore, auth, newId, now });
  const family = new FamilyService({ store: identityStore, newId, now });
  const permissions = new PermissionService({ store: relStore, classContext, newId, now });
  const relationships = new RelationshipService({ store: relStore, identityStore, permissions, newId, now });
  const contributions = new TeacherContributionService({
    permissions,
    sink,
    relationshipStore: relStore,
    newId,
    now,
  });
  return { identityStore, relStore, classContext, sink, identity, family, permissions, relationships, contributions };
}

async function setup(h: ReturnType<typeof makeHarness>, proposed: string[], accessSource: 'PARENT_DIRECT' | 'CLASS_ASSIGNMENT' = 'PARENT_DIRECT') {
  const parent = (await h.identity.register({ email: 'p@x.com', password: 'supersecret', intendedRole: 'PARENT' })).user.id;
  const familyId = await h.family.createFamily(parent);
  const childId = await h.family.createChild({ familyId, creatorUserId: parent, displayName: 'Bé An', schoolGrade: 7 });
  const teacher = (await h.identity.register({ email: 't@x.com', password: 'supersecret', intendedRole: 'TEACHER' })).user.id;
  if (accessSource === 'CLASS_ASSIGNMENT') {
    h.classContext.setActiveAssignment(teacher, 'class-7c0', MATH);
    h.classContext.setPrimaryEnrollment(childId, 'class-7c0', 'enr-1', 'LINKED_SHARED');
  }
  const req = await h.relationships.createRequest({
    requesterUserId: parent,
    requesterRole: 'PARENT',
    relationshipKind: 'TEACHER_CHILD',
    targetType: 'CHILD',
    targetChildId: childId,
    targetUserId: teacher,
    subjectId: MATH,
    accessSource,
    proposedPermissions: proposed as never,
  });
  await h.relationships.acceptRequest(req.id, teacher);
  return { parent, childId, teacher };
}

describe('I5 — teacher learning contributions', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it('a permitted CURRENT_LESSON contribution is appended with provenance, never touches the Twin', async () => {
    const { childId, teacher } = await setup(h, ['SUBMIT_CURRENT_LESSON']);
    const c = await h.contributions.submitContribution({
      teacherUserId: teacher,
      childId,
      subjectId: MATH,
      contributionType: 'CURRENT_LESSON',
      observedAt: '2027-02-09',
      taughtSkillIds: ['M7.QNUM.ORDER_TRANSPOSE'],
      confidence: 'A',
    });
    expect(h.sink.items).toHaveLength(1);
    expect(c.relationshipSourceType).toBe('TEACHER_CHILD_LINK');
    expect(c.relationshipSourceId).toBeDefined();
    expect(c.subjectId).toBe(MATH);
    expect(c.contributionType).toBe('CURRENT_LESSON');
    // the service has no Twin write path — the only output is the append-only sink
  });

  it('subject scope — a MATH grant does not authorise a VIETNAMESE contribution', async () => {
    const { childId, teacher } = await setup(h, ['SUBMIT_CURRENT_LESSON']);
    await expect(
      h.contributions.submitContribution({
        teacherUserId: teacher,
        childId,
        subjectId: VN,
        contributionType: 'CURRENT_LESSON',
        observedAt: '2027-02-09',
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(h.sink.items).toHaveLength(0);
  });

  it('a teacher without the permission is denied', async () => {
    const { childId, teacher } = await setup(h, ['VIEW_CLASS_CONTEXT']);
    await expect(
      h.contributions.submitContribution({
        teacherUserId: teacher,
        childId,
        subjectId: MATH,
        contributionType: 'CURRENT_LESSON',
        observedAt: '2027-02-09',
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('a child-specific SKILL_ASSESSMENT needs an explicit PARENT_DIRECT grant', async () => {
    // class-derived only: the six conditions hold for class-context writes but NOT
    // for a child-specific one
    const { childId, teacher } = await setup(h, ['SUBMIT_CURRENT_LESSON', 'VIEW_CLASS_CONTEXT'], 'CLASS_ASSIGNMENT');
    await expect(
      h.contributions.submitContribution({
        teacherUserId: teacher,
        childId,
        subjectId: MATH,
        contributionType: 'SKILL_ASSESSMENT',
        observedAt: '2027-02-09',
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // grant SUBMIT_SKILL_ASSESSMENT via PARENT_DIRECT → now allowed
    const link = (await h.relationships.listChildRelationships(childId))[0]!;
    await h.permissions.grant({
      linkId: link.id,
      linkType: 'TEACHER_CHILD',
      code: 'SUBMIT_SKILL_ASSESSMENT',
      subjectId: MATH,
      accessSource: 'PARENT_DIRECT',
      grantedByUserId: 'anyone-the-guardian',
    });
    const c = await h.contributions.submitContribution({
      teacherUserId: teacher,
      childId,
      subjectId: MATH,
      contributionType: 'SKILL_ASSESSMENT',
      observedAt: '2027-02-09',
    });
    expect(c.contributionType).toBe('SKILL_ASSESSMENT');
    expect(c.relationshipSourceType).toBe('TEACHER_CHILD_LINK');
  });

  it('BEHAVIOUR_OBSERVATION defaults to PARENT_ONLY visibility', async () => {
    const { childId, teacher } = await setup(h, ['SUBMIT_LEARNING_OBSERVATION']);
    const c = await h.contributions.submitContribution({
      teacherUserId: teacher,
      childId,
      subjectId: MATH,
      contributionType: 'BEHAVIOUR_OBSERVATION',
      observedAt: '2027-02-09',
    });
    expect(c.visibility).toBe('PARENT_ONLY');
  });
});

// The resolver's honouring of an explicit `confidence` tier is covered by a
// focused test in packages/learning-context/src/resolver.test.ts (I5).
