/**
 * @copilot/planning — Learning Mix, Next Best Learning Action and the daily plan
 * (Phase 5). Pure functions over the twin + gap-engine result + learning context.
 *
 * The planner maximises expected learning ROI per available minute (Math Core §40)
 * while keeping to the situation-dependent Learning Mix (§24), and returns
 * `no_plan_needed` when nothing would add value today (UI/UX Spec §17).
 */
export * from './config.js';
export * from './learning-mix.js';
export * from './nbla.js';
export * from './daily-plan.js';
export * from './exercise-spec.js';
