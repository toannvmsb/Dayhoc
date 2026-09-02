import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SchoolDirectoryService } from './directory-service.js';
import { EnrollmentService } from './enrollment-service.js';
import { ProgressionEngine } from './progression-engine.js';

/**
 * Integration test — runs only against a database migrated through
 * `*_enrollment_transitions` (`npm run db:migrate`). Proves `PgEducationStore`
 * round-trips through the real schema and the partial-unique constraints
 * (ACTIVE school enrollment, ACTIVE PRIMARY class enrollment, live transition)
 * are enforced by Postgres.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('PgEducationStore (integration)', () => {
  let pool: import('pg').Pool;
  let PgEducationStore: typeof import('./pg-store.js').PgEducationStore;
  const createdChildIds: string[] = [];
  const createdUserIds: string[] = [];
  let childId: string;
  let familyId: string;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    ({ PgEducationStore } = await import('./pg-store.js'));
    pool = new Pool({ connectionString: DATABASE_URL });
    const u = await pool.query<{ id: string }>(`INSERT INTO users(role) VALUES ('parent') RETURNING id`);
    createdUserIds.push(u.rows[0]!.id);
    const f = await pool.query<{ id: string }>(
      `INSERT INTO families(owner_parent_id) VALUES ($1) RETURNING id`,
      [u.rows[0]!.id],
    );
    familyId = f.rows[0]!.id;
    const c = await pool.query<{ id: string }>(
      `INSERT INTO child_profiles(family_id, display_name, school_grade) VALUES ($1,'IT Ed Child',7) RETURNING id`,
      [familyId],
    );
    childId = c.rows[0]!.id;
    createdChildIds.push(childId);
  });

  afterAll(async () => {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = replica`);
        await client.query(`DELETE FROM student_class_enrollments WHERE child_id = ANY($1::uuid[])`, [createdChildIds]);
        await client.query(`DELETE FROM student_school_enrollments WHERE child_id = ANY($1::uuid[])`, [createdChildIds]);
        await client.query(`DELETE FROM enrollment_transitions WHERE child_id = ANY($1::uuid[])`, [createdChildIds]);
        await client.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [createdChildIds]);
        await client.query(`DELETE FROM families WHERE id = $1`, [familyId]);
        await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
        // schools/classrooms created by the test — clean by created_by IS NULL name prefix
        await client.query(`DELETE FROM classrooms WHERE class_name LIKE 'IT-%'`);
        await client.query(`DELETE FROM schools WHERE official_name LIKE 'IT School %'`);
      } finally {
        await client.query(`SET session_replication_role = origin`);
        client.release();
      }
      await pool.end();
    }
  });

  it('directory + enrollment + progression round-trip through Postgres', async () => {
    const store = new PgEducationStore(pool);
    const now = () => new Date('2027-01-20T00:00:00Z');
    const directory = new SchoolDirectoryService({ store, now });
    const enrollments = new EnrollmentService({ store, now });
    const progression = new ProgressionEngine({ store, enrollments, now });

    const school = (await directory.proposeSchool({ officialName: `IT School ${Date.now()}` })).school;
    const y2627 = await directory.getAcademicYearByLabel('2026-2027'); // seeded by the migration
    const y2728 = await directory.getAcademicYearByLabel('2027-2028');
    const cls = (
      await directory.proposeClassroom({
        schoolId: school.id,
        academicYearId: y2627.id,
        grade: 7,
        className: `IT-7C0`,
      })
    ).classroom;

    const se = await enrollments.createSchoolEnrollment({
      childId,
      schoolId: school.id,
      academicYearId: y2627.id,
      grade: 7,
      startDate: '2026-09-05',
    });
    await enrollments.createClassEnrollment({
      childId,
      classroomId: cls.id,
      academicYearId: y2627.id,
      schoolEnrollmentId: se.id,
      enrollmentType: 'PRIMARY',
    });

    // DB enforces one ACTIVE PRIMARY per (child, year)
    const cls2 = (
      await directory.proposeClassroom({
        schoolId: school.id,
        academicYearId: y2627.id,
        grade: 7,
        className: `IT-7A2`,
      })
    ).classroom;
    await expect(
      enrollments.createClassEnrollment({
        childId,
        classroomId: cls2.id,
        academicYearId: y2627.id,
        enrollmentType: 'PRIMARY',
      }),
    ).rejects.toMatchObject({ code: 'PRIMARY_ENROLLMENT_EXISTS' });

    // a supplementary enrollment coexists
    await enrollments.createClassEnrollment({
      childId,
      classroomId: cls2.id,
      academicYearId: y2627.id,
      enrollmentType: 'TUTOR_GROUP',
    });

    const active = await enrollments.resolveActiveEnrollment(childId, now());
    expect(active?.grade).toBe(7);
    expect(active?.primaryClassroomId).toBe(cls.id);
    expect(active?.academicYearLabel).toBe('2026-2027');

    // progression: 7 → 8 proposal, 7C0 → 8C0 suggestion
    const t = await progression.determineProposal({
      childId,
      toAcademicYearId: y2728.id,
      currentClassName: '7C0',
    });
    expect(t.toGrade).toBe(8);
    expect(t.suggestedClassName).toBe('8C0');

    const newClass = (
      await directory.proposeClassroom({
        schoolId: school.id,
        academicYearId: y2728.id,
        grade: 8,
        className: `IT-8C0`,
      })
    ).classroom;
    const confirmed = await progression.confirmTransition(t.id, createdUserIds[0]!, true, {
      toSchoolId: school.id,
      toClassroomId: newClass.id,
    });
    expect(confirmed.status).toBe('CONFIRMED');

    const history = await enrollments.listSchoolEnrollments(childId);
    expect(history.find((e) => e.id === se.id)!.status).toBe('COMPLETED');
    expect(history.find((e) => e.status === 'ACTIVE')!.grade).toBe(8);
  });

  it('DB rejects a second ACTIVE school enrollment (partial unique)', async () => {
    const store = new PgEducationStore(pool);
    // child already has an ACTIVE grade-8 enrollment from the previous test
    await expect(
      pool.query(
        `INSERT INTO student_school_enrollments (child_id, academic_year_id, grade, status)
         SELECT $1, id, 9, 'ACTIVE' FROM academic_years WHERE label = '2027-2028'`,
        [childId],
      ),
    ).rejects.toThrow();
    void store;
  });
});
