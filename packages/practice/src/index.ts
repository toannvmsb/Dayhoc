/**
 * @copilot/practice — practice loop for Phase 5.
 *
 * - hint-ladder state machine (Math Core §13, §17); dependency feeds evidence
 * - stretch-zone selection (~75% solvable / ~25% productive struggle, §17)
 * - assignment builder from planned actions (LEGACY delivery path — superseded
 *   by AI generation in Group C5; still reads `@copilot/reference-library` as a
 *   compatibility shim until the generation runtime lands)
 * - submissionToEvidence — closes the loop back into the append-only ledger
 *
 * The question corpus moved to `@copilot/reference-library` (grounding /
 * calibration / evaluation only — never "pick a question to serve a child").
 */
export * from './hint-ladder.js';
export * from './stretch-zone.js';
export * from './assignment.js';
export * from './submission.js';
export * from './offline-queue.js';
