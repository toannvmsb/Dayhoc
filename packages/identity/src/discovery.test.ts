import { describe, expect, it } from 'vitest';
import {
  InMemoryEducationStore,
  SchoolDirectoryService,
  EnrollmentService,
} from '@copilot/education-directory';
import { InMemoryAuthAdapter } from './auth-adapter.js';
import { DiscoveryService } from './discovery-service.js';
import { FamilyService } from './family-service.js';
import { IdentityService } from './identity-service.js';
import { InMemoryRelationshipStore } from './relationship-store.js';
import { InMemoryIdentityStore } from './store.js';

describe('I7 — privacy-safe discovery: email lookup + class-join', () => {
  it('emailLookup returns only yes/no, never any child', async () => {
    const identityStore = new InMemoryIdentityStore();
    const relStore = new InMemoryRelationshipStore();
    const eduStore = new InMemoryEducationStore();
    const identity = new IdentityService({ store: identityStore, auth: new InMemoryAuthAdapter() });
    const discovery = new DiscoveryService({ identityStore, relationshipStore: relStore, educationStore: eduStore });

    await identity.register({ email: 'known@x.com', password: 'supersecret', intendedRole: 'PARENT' });
    expect(await discovery.emailLookup('known@x.com')).toEqual({ accountExists: true });
    expect(await discovery.emailLookup('unknown@x.com')).toEqual({ accountExists: false });
  });

  it('classJoinCandidates lists opted-in children only, display name + class', async () => {
    const identityStore = new InMemoryIdentityStore();
    const relStore = new InMemoryRelationshipStore();
    const eduStore = new InMemoryEducationStore();
    let seq = 0;
    const newId = () => `d_${(seq += 1).toString().padStart(3, '0')}`;
    const now = () => new Date('2027-01-20T00:00:00Z');
    const identity = new IdentityService({ store: identityStore, auth: new InMemoryAuthAdapter(), newId, now });
    const family = new FamilyService({ store: identityStore, newId, now });
    const directory = new SchoolDirectoryService({ store: eduStore, newId, now });
    const enrollments = new EnrollmentService({ store: eduStore, newId, now });
    const discovery = new DiscoveryService({ identityStore, relationshipStore: relStore, educationStore: eduStore });

    const parent = (await identity.register({ email: 'p@x.com', password: 'supersecret', intendedRole: 'PARENT' })).user.id;
    const familyId = await family.createFamily(parent);
    const child1 = await family.createChild({ familyId, creatorUserId: parent, displayName: 'An', schoolGrade: 7 });
    const child2 = await family.createChild({ familyId, creatorUserId: parent, displayName: 'Bình', schoolGrade: 7 });
    const teacher = (await identity.register({ email: 't@x.com', password: 'supersecret', intendedRole: 'TEACHER' })).user.id;

    const year = await directory.ensureAcademicYear({ label: '2026-2027', startDate: '2026-09-05', endDate: '2027-05-31' });
    const math = await directory.ensureSubject('MATH', 'Toán', 'ACTIVE');
    const school = (await directory.proposeSchool({ officialName: 'THCS X' })).school;
    const cls = (await directory.proposeClassroom({ schoolId: school.id, academicYearId: year.id, grade: 7, className: '7C0' })).classroom;
    await eduStore.insertTeacherClassAssignment({
      id: newId(),
      teacherUserId: teacher,
      classroomId: cls.id,
      academicYearId: year.id,
      subjectId: math.id,
      role: 'SUBJECT_TEACHER',
      status: 'ACTIVE',
      verificationStatus: 'SELF_DECLARED',
      createdAt: now().toISOString(),
      endedAt: null,
    });
    // child1: LINKED_SHARED primary, opted in (default) → visible
    await enrollments.createClassEnrollment({ childId: child1, classroomId: cls.id, academicYearId: year.id, enrollmentType: 'PRIMARY', privacyMode: 'LINKED_SHARED' });
    // child2: PRIVATE_LEARNING primary → invisible
    await enrollments.createClassEnrollment({ childId: child2, classroomId: cls.id, academicYearId: year.id, enrollmentType: 'PRIMARY', privacyMode: 'PRIVATE_LEARNING' });

    const candidates = await discovery.classJoinCandidates(teacher);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({ childId: child1, displayName: 'An', classroomId: cls.id });

    // child1 guardian opts out → now invisible
    await relStore.upsertPrivacyPreferences({
      childId: child1,
      defaultClassPrivacyMode: 'LINKED_SHARED',
      allowTeacherDiscoveryByEmail: false,
      allowTeacherDiscoveryByClassJoin: false,
      shareBehaviourObservationsWithChild: false,
      updatedBy: parent,
      updatedAt: now().toISOString(),
    });
    expect(await discovery.classJoinCandidates(teacher)).toHaveLength(0);
  });
});
