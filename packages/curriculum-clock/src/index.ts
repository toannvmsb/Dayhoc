/**
 * @copilot/curriculum-clock — CurriculumClockService (Pricing v1.1 §2).
 *
 * Estimates the current SGK lesson from the academic calendar so the product
 * works with zero parent/teacher input. Deterministic; output is always
 * `ESTIMATED` confidence, discounted by the LearningContextResolver.
 */
export * from './clock.js';
