/**
 * @copilot/math-data — normalized Grade 4 + Grade 7 math knowledge base.
 *
 * Curriculum nodes, grade-opaque Skill IDs, a cross-grade prerequisite DAG, and
 * problem types each tagged with an independent (Knowledge, Thinking) level.
 * Data lives in versioned JSON (src/data/*.json); the loader validates every file
 * against Zod schemas and cross-checks referential integrity + acyclicity before
 * returning an indexed KnowledgeBase. Invalid data is a hard failure.
 *
 * Data source: Math Dev Core v1.0 (`data/dev-core/`, anh-supplied) — 52 Grade 4
 * skills + 37 Grade 7 (`M7.*`, provisional normalization) — converted to the
 * loader schema by `scripts/build-kb.mjs` (run `npm run data -w @copilot/math-data`).
 * Cross-grade prerequisite bridges (M4 → M7) live in `data/bridges.yaml` and are
 * flagged for math-educator review (P-01).
 */
export * from './schema.js';
export * from './loader.js';
