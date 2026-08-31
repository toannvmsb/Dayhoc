import { z } from 'zod';

const isoDateTime = z.string().datetime({ offset: true });
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/**
 * Inbound TeacherContribution (Math Core §32 / UI/UX Spec §14).
 * Authored by a teacher, OR by a parent on the teacher's behalf (`contributedAs`).
 * The app must work with zero of these — this is an optional context source.
 */
export const teacherContributionInputSchema = z.object({
  childId: z.string().min(1),
  contributedAs: z.enum(['teacher', 'parent']),
  actorUserId: z.string().min(1),
  occurredOn: isoDay,
  taughtSkillIds: z.array(z.string().min(1)).default([]),
  problemTypeIds: z.array(z.string().min(1)).default([]),
  homeworkRefs: z.array(z.string()).default([]),
  examRef: z
    .object({ date: isoDay, scopeNote: z.string().optional() })
    .optional(),
});

export type TeacherContributionInput = z.infer<typeof teacherContributionInputSchema>;

export const isoTimestampSchema = isoDateTime;
