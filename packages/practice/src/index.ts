/**
 * @copilot/practice — adaptive practice for Phase 5.
 *
 * - authored question bank (validated), each with the full six-rung hint ladder
 * - hint-ladder state machine (Math Core §13, §17); dependency feeds evidence
 * - stretch-zone selection (~75% solvable / ~25% productive struggle, §17)
 * - assignment builder from planned actions
 * - submissionToEvidence — closes the loop back into the append-only ledger
 */
export * from './question-bank.js';
export * from './hint-ladder.js';
export * from './stretch-zone.js';
export * from './assignment.js';
export * from './submission.js';
export * from './offline-queue.js';
