/**
 * @copilot/revision — exam / revision mode, post-exam diagnosis, weekly report,
 * notifications (Phase 9). Pure functions over the twin + gap-engine result.
 *
 * The exam flow works with only a date + recent context: `inferExamScope`
 * proposes a scope and asks the parent to confirm. `buildRevisionPlan` ranks by
 * revision_priority (Math Core §28). `diagnoseAssessment` classifies each lost
 * point rather than treating every dropped mark alike.
 */
export * from './scope.js';
export * from './revision-plan.js';
export * from './assessment.js';
export * from './weekly-report.js';
export * from './notifications.js';
