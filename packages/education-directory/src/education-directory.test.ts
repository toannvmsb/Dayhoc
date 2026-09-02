import { beforeEach, describe, expect, it } from 'vitest';
import { suggestNextClassName } from '@copilot/domain';
import { SchoolDirectoryService } from './directory-service.js';
import { EnrollmentService } from './enrollment-service.js';
import { ProgressionEngine } from './progression-engine.js';
import { InMemoryEducationStore } from './store.js';
import { AuthorizationError, ConflictError, ValidationError } from './errors.js';

function makeHarness() {
  const store = new InMemoryEducationStore();
  let seq = 0;
  const newId = () => `ed_${(seq += 1).toString().padStart(3, '0')}`;
  const now = () => new Date('2027-01-20T00:00:00.000Z');
  const directory = new SchoolDirectoryService({ store, newId, now });
  const enrollments = new EnrollmentService({ store, newId, now });
  const progression = new ProgressionEngine({ store, enrollments, newId, now });
  return { store, directory, enrollments, progression };
}

async function seedYears(h: ReturnType<typeof makeHarness>) {
  const y2627 = await h.directory.ensureAcademicYear({
    label: '2026-2027',
    startDate: '2026-09-05',
    endDate: '2027-05-31',
  });
  const y2728 = await h.directory.ensureAcademicYear({
    label: '2027-2028',
    startDate: '2027-09-05',
    endDate: '2028-05-31',
  });
  return { y2627, y2728 };
}

describe('I2 — education directory', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it('same school name at a different address is a DISTINCT school (E-1)', async () => {
    const a = await h.directory.proposeSchool({
      officialName: 'Trường THCS Lê Quý Đôn',
      province: 'Hà Nội',
      district: 'Cầu Giấy',
      address: '1 Nguyễn Khánh Toàn',
    });
    const b = await h.directory.proposeSchool({
      officialName: 'Trường THCS Lê Quý Đôn',
      province: 'Hà Nội',
      district: 'Hà Đông',
      address: '10 Tô Hiệu',
    });
    expect(a.deduplicated).toBe(false);
    expect(b.deduplicated).toBe(false);
    expect(a.school.id).not.toBe(b.school.id);
    // the second proposal surfaces the first as a near-match, but does NOT merge
    expect(b.similarCandidates.map((s) => s.id)).toContain(a.school.id);
  });

  it('an identical identity key returns the existing school (conservative de-dup)', async () => {
    const first = await h.directory.proposeSchool({
      officialName: 'Trường Tiểu học Kim Đồng',
      province: 'Đà Nẵng',
      district: 'Hải Châu',
      address: '5 Trần Phú',
    });
    const again = await h.directory.proposeSchool({
      officialName: 'trường tiểu học kim đồng', // case-insensitive
      province: 'Đà Nẵng',
      district: 'Hải Châu',
      address: '5 Trần Phú',
    });
    expect(again.deduplicated).toBe(true);
    expect(again.school.id).toBe(first.school.id);
  });

  it('same class name in a different academic year is a DISTINCT classroom (E-2)', async () => {
    const { y2627, y2728 } = await seedYears(h);
    const school = (await h.directory.proposeSchool({ officialName: 'Trường THCS Nguyễn Du' })).school;
    const c1 = await h.directory.proposeClassroom({
      schoolId: school.id,
      academicYearId: y2627.id,
      grade: 7,
      className: '7C0',
    });
    const c2 = await h.directory.proposeClassroom({
      schoolId: school.id,
      academicYearId: y2728.id,
      grade: 8,
      className: '8C0',
    });
    expect(c1.classroom.id).not.toBe(c2.classroom.id);
    // re-proposing the same identity de-dups
    const c1again = await h.directory.proposeClassroom({
      schoolId: school.id,
      academicYearId: y2627.id,
      grade: 7,
      className: '7C0',
    });
    expect(c1again.deduplicated).toBe(true);
    expect(c1again.classroom.id).toBe(c1.classroom.id);
  });

  it('seeded subjects: MATH ACTIVE', async () => {
    await h.directory.ensureSubject('MATH', 'Toán', 'ACTIVE');
    const math = await h.directory.getSubjectByCode('MATH');
    expect(math.status).toBe('ACTIVE');
  });
});

describe('I3 — historical enrollment + PRIMARY / supplementary', () => {
  let h: ReturnType<typeof makeHarness>;
  let y2627: string;
  let y2728: string;
  let schoolId: string;
  let primaryClassId: string;
  let hsgClassId: string;
  const childId = 'child-i3-001';

  beforeEach(async () => {
    h = makeHarness();
    const years = await seedYears(h);
    y2627 = years.y2627.id;
    y2728 = years.y2728.id;
    schoolId = (await h.directory.proposeSchool({ officialName: 'Trường THCS Chu Văn An' })).school.id;
    primaryClassId = (
      await h.directory.proposeClassroom({ schoolId, academicYearId: y2627, grade: 7, className: '7C0' })
    ).classroom.id;
    hsgClassId = (
      await h.directory.proposeClassroom({ schoolId, academicYearId: y2627, grade: 7, className: '7-HSG-Toán' })
    ).classroom.id;
  });

  it('A (55) — PRIMARY + HSG_TEAM coexist for the same child + year', async () => {
    const se = await h.enrollments.createSchoolEnrollment({
      childId,
      schoolId,
      academicYearId: y2627,
      grade: 7,
    });
    const primary = await h.enrollments.createClassEnrollment({
      childId,
      classroomId: primaryClassId,
      academicYearId: y2627,
      schoolEnrollmentId: se.id,
      enrollmentType: 'PRIMARY',
    });
    const hsg = await h.enrollments.createClassEnrollment({
      childId,
      classroomId: hsgClassId,
      academicYearId: y2627,
      enrollmentType: 'HSG_TEAM',
    });
    expect(primary.status).toBe('ACTIVE');
    expect(hsg.status).toBe('ACTIVE');
    const all = await h.enrollments.listClassEnrollments(childId);
    expect(all.filter((e) => e.status === 'ACTIVE')).toHaveLength(2);
  });

  it('B (56) — a second ACTIVE PRIMARY for the same year is rejected', async () => {
    await h.enrollments.createSchoolEnrollment({ childId, schoolId, academicYearId: y2627, grade: 7 });
    await h.enrollments.createClassEnrollment({
      childId,
      classroomId: primaryClassId,
      academicYearId: y2627,
      enrollmentType: 'PRIMARY',
    });
    const other = (
      await h.directory.proposeClassroom({ schoolId, academicYearId: y2627, grade: 7, className: '7A2' })
    ).classroom.id;
    await expect(
      h.enrollments.createClassEnrollment({
        childId,
        classroomId: other,
        academicYearId: y2627,
        enrollmentType: 'PRIMARY',
      }),
    ).rejects.toMatchObject({ code: 'PRIMARY_ENROLLMENT_EXISTS' });
  });

  it('C (57) — supplementary / HSG is NOT the Curriculum Clock primary classroom', async () => {
    // only an HSG_TEAM enrollment, no PRIMARY, no school enrollment
    await h.enrollments.createClassEnrollment({
      childId,
      classroomId: hsgClassId,
      academicYearId: y2627,
      enrollmentType: 'HSG_TEAM',
    });
    const asOf = new Date('2027-01-20T00:00:00Z');
    expect(await h.enrollments.resolveActiveEnrollment(childId, asOf)).toBeNull();
    expect(await h.enrollments.resolveDefaultClassroom(childId, asOf)).toBeNull();

    // add a PRIMARY + ACTIVE school enrollment → now the clock resolves, to the PRIMARY class only
    await h.enrollments.createSchoolEnrollment({ childId, schoolId, academicYearId: y2627, grade: 7 });
    await h.enrollments.createClassEnrollment({
      childId,
      classroomId: primaryClassId,
      academicYearId: y2627,
      enrollmentType: 'PRIMARY',
    });
    const active = await h.enrollments.resolveActiveEnrollment(childId, asOf);
    expect(active?.grade).toBe(7);
    expect(active?.primaryClassroomId).toBe(primaryClassId);
    expect(await h.enrollments.resolveDefaultClassroom(childId, asOf)).toBe(primaryClassId);
  });

  it('history is preserved — a new ACTIVE school enrollment completes the old one, never overwrites', async () => {
    const first = await h.enrollments.createSchoolEnrollment({
      childId,
      schoolId,
      academicYearId: y2627,
      grade: 7,
    });
    const otherSchool = (await h.directory.proposeSchool({ officialName: 'Trường THCS Trưng Vương' })).school.id;
    const second = await h.enrollments.createSchoolEnrollment({
      childId,
      schoolId: otherSchool,
      academicYearId: y2728,
      grade: 8,
    });
    const history = await h.enrollments.listSchoolEnrollments(childId);
    expect(history).toHaveLength(2);
    const old = history.find((e) => e.id === first.id)!;
    expect(old.status).toBe('COMPLETED');
    expect(old.grade).toBe(7); // untouched content
    expect(old.schoolId).toBe(schoolId);
    expect(history.find((e) => e.id === second.id)!.status).toBe('ACTIVE');
  });
});

describe('I6 — academic progression engine', () => {
  let h: ReturnType<typeof makeHarness>;
  let y2627: string;
  let y2728: string;
  let schoolA: string;
  const childId = 'child-i6-001';
  const guardian = 'user-guardian-001';

  beforeEach(async () => {
    h = makeHarness();
    const years = await seedYears(h);
    y2627 = years.y2627.id;
    y2728 = years.y2728.id;
    schoolA = (await h.directory.proposeSchool({ officialName: 'Trường THCS A' })).school.id;
  });

  async function enrolGrade(grade: number, className: string) {
    const se = await h.enrollments.createSchoolEnrollment({
      childId,
      schoolId: schoolA,
      academicYearId: y2627,
      grade,
    });
    const cls = (
      await h.directory.proposeClassroom({ schoolId: schoolA, academicYearId: y2627, grade, className })
    ).classroom;
    await h.enrollments.createClassEnrollment({
      childId,
      classroomId: cls.id,
      academicYearId: y2627,
      schoolEnrollmentId: se.id,
      enrollmentType: 'PRIMARY',
    });
    return { se, cls };
  }

  it('suggestNextClassName is a pure heuristic', () => {
    expect(suggestNextClassName('7C0', 8)).toBe('8C0');
    expect(suggestNextClassName('7A2', 8)).toBe('8A2');
    expect(suggestNextClassName('6/1', 7)).toBe('7/1');
    expect(suggestNextClassName('Lớp chọn', 8)).toBeNull();
  });

  it('Grade 7 → 8 PROMOTION proposal; 7C0 → 8C0 is a SUGGESTION only', async () => {
    await enrolGrade(7, '7C0');
    const t = await h.progression.determineProposal({
      childId,
      toAcademicYearId: y2728,
      currentClassName: '7C0',
    });
    expect(t.transitionType).toBe('PROMOTION');
    expect(t.toGrade).toBe(8);
    expect(t.suggestedClassName).toBe('8C0');
    expect(t.toClassroomId).toBeNull(); // never auto — guardian confirms/creates
    expect(t.requiresSchoolConfirmation).toBe(false);
    // idempotent
    const again = await h.progression.determineProposal({ childId, toAcademicYearId: y2728 });
    expect(again.id).toBe(t.id);
  });

  it('Grade 5 → 6 and Grade 9 → 10 require school confirmation (to_school null)', async () => {
    // grade 5 child
    await enrolGrade(5, '5A');
    const t56 = await h.progression.determineProposal({ childId, toAcademicYearId: y2728, currentClassName: '5A' });
    expect(t56.requiresSchoolConfirmation).toBe(true);
    expect(t56.toSchoolId).toBeNull();
    // cannot confirm without a school
    await expect(
      h.progression.confirmTransition(t56.id, guardian, true, {}),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('Grade 9 → 10 boundary', async () => {
    await enrolGrade(9, '9C');
    const t = await h.progression.determineProposal({ childId, toAcademicYearId: y2728 });
    expect(t.requiresSchoolConfirmation).toBe(true);
    expect(t.toGrade).toBe(10);
    expect(t.toSchoolId).toBeNull();
  });

  it('Grade 12 → GRADUATION (no new enrollment)', async () => {
    await enrolGrade(12, '12A1');
    const t = await h.progression.determineProposal({ childId, toAcademicYearId: y2728 });
    expect(t.transitionType).toBe('GRADUATION');
    expect(t.toGrade).toBeNull();
  });

  it('REPEAT_GRADE never auto-promotes and keeps the same grade', async () => {
    await enrolGrade(7, '7C0');
    const t = await h.progression.proposeManualTransition({
      childId,
      transitionType: 'REPEAT_GRADE',
      toAcademicYearId: y2728,
      proposedBy: 'PARENT',
      proposedByUserId: guardian,
    });
    expect(t.toGrade).toBe(7);
  });

  it('confirmTransition is atomic: old ACTIVE PRIMARY closes, new ACTIVE opens, history + child_id intact', async () => {
    const { se, cls } = await enrolGrade(7, '7C0');
    const t = await h.progression.determineProposal({ childId, toAcademicYearId: y2728, currentClassName: '7C0' });
    const newClass = (
      await h.directory.proposeClassroom({ schoolId: schoolA, academicYearId: y2728, grade: 8, className: '8C0' })
    ).classroom;

    const confirmed = await h.progression.confirmTransition(t.id, guardian, true, {
      toSchoolId: schoolA,
      toClassroomId: newClass.id,
    });
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.confirmedByUserId).toBe(guardian);

    const schoolHistory = await h.enrollments.listSchoolEnrollments(childId);
    expect(schoolHistory).toHaveLength(2);
    expect(schoolHistory.find((e) => e.id === se.id)!.status).toBe('COMPLETED');
    const nowActive = schoolHistory.find((e) => e.status === 'ACTIVE')!;
    expect(nowActive.grade).toBe(8);

    const classHistory = await h.enrollments.listClassEnrollments(childId);
    expect(classHistory.find((e) => e.classroomId === cls.id)!.status).toBe('LEFT');
    const activePrimary = classHistory.find((e) => e.status === 'ACTIVE' && e.enrollmentType === 'PRIMARY')!;
    expect(activePrimary.classroomId).toBe(newClass.id);

    // child_id is the same throughout — the engine never touches it
    expect(new Set(classHistory.map((e) => e.childId))).toEqual(new Set([childId]));
  });

  it('confirmTransition refuses an unauthorised actor', async () => {
    await enrolGrade(7, '7C0');
    const t = await h.progression.determineProposal({ childId, toAcademicYearId: y2728 });
    await expect(
      h.progression.confirmTransition(t.id, 'stranger', false, { toSchoolId: schoolA }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('SCHOOL_TRANSFER marks the old enrollment TRANSFERRED', async () => {
    const { se } = await enrolGrade(7, '7C0');
    const schoolB = (await h.directory.proposeSchool({ officialName: 'Trường THCS B' })).school.id;
    const t = await h.progression.proposeManualTransition({
      childId,
      transitionType: 'SCHOOL_TRANSFER',
      toAcademicYearId: y2728,
      toGrade: 8,
      toSchoolId: schoolB,
      proposedBy: 'PARENT',
      proposedByUserId: guardian,
    });
    await h.progression.confirmTransition(t.id, guardian, true, { toSchoolId: schoolB });
    const history = await h.enrollments.listSchoolEnrollments(childId);
    expect(history.find((e) => e.id === se.id)!.status).toBe('TRANSFERRED');
  });

  it('a live transition per (child, target year) is enforced', async () => {
    await enrolGrade(7, '7C0');
    await h.progression.determineProposal({ childId, toAcademicYearId: y2728 });
    await expect(
      h.progression.proposeManualTransition({
        childId,
        transitionType: 'CLASS_CHANGE',
        toAcademicYearId: y2728,
        proposedBy: 'PARENT',
        proposedByUserId: guardian,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
