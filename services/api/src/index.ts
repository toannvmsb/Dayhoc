/**
 * @copilot/api — the API surface for web + mobile (Phase 10).
 *
 * Role-gated handlers over the deterministic pipeline. Parent/teacher tokens are
 * scoped to their family; a CHILD token is scoped to one child, can only reach
 * child-safe views, and every child response is re-checked with `assertChildSafe`
 * before it leaves the process. Writes go through the append-only evidence
 * ledger. An HTTP transport (Fastify) wraps these handlers 1:1 later.
 */
export * from './api.js';
export * from './production/production-api.js';
export * from './production/context.js';
export * from './production/transaction.js';
export { resolveChildLearningInputs, syncSchoolGradeCache } from './production/learning-scene.js';

// deploy surface — durable worksheet worker + operational maintenance (doc 69/70)
export { createWorksheetJobWorker } from './production/worksheet-generation.js';
export {
  resolveKillSwitch,
  setKillSwitch,
  scanInternalLiveSafety,
  enforceSafetyAutoStop,
  loadInternalLiveBudgets,
  internalLiveSpendToday,
  listInternalLiveCohort,
} from './production/internal-live.js';
export {
  purgeExpiredQaSamples,
  internalLiveDashboard,
  pilotDashboard,
} from './production/internal-live-observability.js';
export { purgeStaleServingIntents } from './production/internal-live-serving.js';
export { listPilotFamilies, feedbackRollup } from './production/pilot.js';
