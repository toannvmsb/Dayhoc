/**
 * @copilot/math-data — normalized Grade 4 + Grade 7 math knowledge base.
 *
 * Curriculum nodes, grade-opaque Skill IDs, a cross-grade prerequisite DAG, and
 * problem types each tagged with an independent (Knowledge, Thinking) level.
 * Data lives in versioned JSON (src/data/*.json); the loader validates every file
 * against Zod schemas and cross-checks referential integrity + acyclicity before
 * returning an indexed KnowledgeBase. Invalid data is a hard failure.
 *
 * Phase 1 ships a vertical slice — the fraction chain, distributive property, and
 * the ratio → equal-ratio-chain → multivariable families — enough to exercise the
 * Grade 4 and Grade 7 golden scenarios and the cross-grade prerequisite bridge
 * (M4.FRAC.COMMON_DENOM → G7.RAT.OPS → G7.RATIO.*).
 */
export * from './schema.js';
export * from './loader.js';
