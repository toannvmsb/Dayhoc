import type { Pool } from 'pg';
import type { GradeContext } from '@copilot/domain';
import type { EnrollmentService } from '@copilot/education-directory';
import type { KnowledgeBase } from '@copilot/math-data';
import type { ChildProfileInput } from '@copilot/projections';
import { NotFoundError } from '../api.js';

export interface ChildLearningInputs {
  readonly profile: ChildProfileInput;
  readonly gradeContext: GradeContext;
  /** Curriculum Clock input — ONLY from an ACTIVE PRIMARY school enrollment. */
  readonly enrollment:
    | { readonly curriculum: string; readonly academicYear: string; readonly calendarId?: string }
    | undefined;
  readonly familyId: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Resolve the per-child inputs the C4/C5 learning pipeline needs — from the DB,
 * not an in-memory `childProfiles` dict (OD-4).
 *
 *  - `gradeContext` comes from the ACTIVE PRIMARY school enrollment
 *    (`EnrollmentService.resolveActiveEnrollment`). `child_profiles.school_grade`
 *    is a compatibility cache, used ONLY when there is no ACTIVE enrollment yet.
 *  - `enrollment` (the Curriculum Clock input) is present ONLY for an ACTIVE
 *    enrollment. A PROPOSED / missing enrollment → `undefined` → the pipeline
 *    falls back to the evidence/timeline-safe path (HC09 preserved).
 *  - supplementary / HSG / tutor enrollments never appear here — `resolveActiveEnrollment`
 *    reads the ACTIVE school row + ACTIVE PRIMARY class row only.
 */
export async function resolveChildLearningInputs(
  pool: Pool,
  enrollments: EnrollmentService,
  childId: string,
  asOf: Date,
): Promise<ChildLearningInputs> {
  const row = (
    await pool.query(
      `SELECT id, family_id, display_name, school_grade, school_context, deletion_state
         FROM child_profiles WHERE id = $1`,
      [childId],
    )
  ).rows[0] as any;
  if (!row || row.deletion_state === 'deleted') throw new NotFoundError(`unknown child ${childId}`);

  const active = await enrollments.resolveActiveEnrollment(childId, asOf);

  const grade = (active?.grade ?? row.school_grade) as GradeContext;
  const schoolContext =
    (typeof row.school_context === 'object' && row.school_context?.name) ||
    (active ? active.curriculumId : 'Kết nối tri thức');

  return {
    profile: {
      childId,
      displayName: row.display_name,
      schoolGrade: grade,
      schoolContext: String(schoolContext),
    },
    gradeContext: grade,
    enrollment: active
      ? {
          curriculum: active.curriculumId,
          academicYear: active.academicYearLabel,
          ...(active.calendarId ? { calendarId: active.calendarId } : {}),
        }
      : undefined,
    familyId: row.family_id,
  };
}

/**
 * The `child_profiles.school_grade` synchronization rule (ID-Q9): whenever an
 * enrollment changes, re-assert the cache from the ACTIVE PRIMARY school
 * enrollment. Idempotent. `school_grade` is NEVER authoritative over the
 * enrollment — this only keeps the legacy readers correct until they migrate.
 */
export async function syncSchoolGradeCache(
  pool: Pool,
  enrollments: EnrollmentService,
  childId: string,
  asOf: Date,
): Promise<void> {
  const active = await enrollments.resolveActiveEnrollment(childId, asOf);
  if (!active) return; // no ACTIVE enrollment → leave the last known cache
  if (active.grade < 1 || active.grade > 9) return; // CHECK constraint bound
  await pool.query(`UPDATE child_profiles SET school_grade = $1 WHERE id = $2 AND school_grade <> $1`, [
    active.grade,
    childId,
  ]);
}

export function knowledgeBaseFrom(kb: KnowledgeBase): KnowledgeBase {
  return kb;
}
