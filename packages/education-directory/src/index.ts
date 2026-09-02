/**
 * @copilot/education-directory — schools, academic years, subjects, classrooms,
 * teacher ↔ school/class links, enrollment history (PRIMARY vs supplementary),
 * and the Academic Progression Engine (migration groups I2, I3, I6 — docs 20,
 * 23, 24).
 *
 * ID-Q8: education-specific enrollment/curriculum logic lives here, not in
 * `@copilot/identity`. This package depends only on `@copilot/domain` +
 * `@copilot/observability` — no dependency on identity, no cycle.
 *
 * Invariants:
 *  - A School is not identified by name (E-1) — de-dup is exact-key only.
 *  - Academic Year is first-class; a classroom is `(school, year, grade, name)` (E-2).
 *  - Enrollment history is never overwritten (E-3, P-1).
 *  - ≤ 1 ACTIVE PRIMARY class enrollment per Child per academic period;
 *    supplementary enrollments are unconstrained (E-7).
 *  - Only PRIMARY drives the Curriculum Clock, school-grade context, progression.
 */
export * from './errors.js';
export * from './store.js';
export * from './directory-service.js';
export * from './enrollment-service.js';
export * from './progression-engine.js';
