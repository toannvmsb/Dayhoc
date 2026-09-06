/**
 * @copilot/exercise-gen — the deterministic side of AI exercise generation
 * (doc 14 §6, C3 + C4) plus the C5 live-generation shadow-mode infrastructure.
 * Contains the validator, the generator INTERFACE, a deterministic grounding
 * builder, a Mock generator (no network), `LunaExerciseGenerator` (a real
 * `AIProviderAdapter`-backed implementation of that same interface), the
 * bounded orchestrator state machine, answer verification, a second-pass
 * verifier port, the shadow-mode runner, and shadow quality metrics.
 *
 * The Postgres persistence backend is at `@copilot/exercise-gen/pg` (keeps
 * `pg` out of the default import graph for pure/test consumers).
 */
export * from './validator.js';
export * from './reference-similarity.js';
export * from './grounding.js';
export * from './generator.js';
export * from './mock-generator.js';
export * from './luna-generator.js';
export * from './repair.js';
export * from './telemetry.js';
export * from './cost.js';
export * from './orchestrator.js';
export * from './persistence.js';
export * from './answer-verification.js';
export * from './math-verifier.js';
export * from './verifier.js';
export * from './shadow.js';
export * from './shadow-metrics.js';

// --- reliability redesign (doc 56) — item-level generation ---
export * from './item-spec.js';
export * from './problem-dna.js';
export * from './similarity-gate.js';
export * from './compose.js';
export * from './item-generator.js';
export * from './mock-item-generator.js';
export * from './luna-item-generator.js';
export * from './item-validator.js';
export * from './item-routing.js';
export * from './item-orchestrator.js';
export * from './item-metrics.js';

// --- answer verification architecture (doc 58) — deterministic MathKernel ---
export * from './math-kernel.js';
export * from './kernel-oracle.js';
export * from './kernel-validator.js';
export * from './semantic-normalizer.js';
export * from './answer-crosscheck.js';
export * from './problem-type-matrix.js';
export * from './model-router.js';
export * from './retry-context.js';
export * from './kernel-templater.js';
export * from './last-resort.js';
export * from './worksheet-orchestrator.js';
export * from './fault-injecting-generator.js';
