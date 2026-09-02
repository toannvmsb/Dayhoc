/**
 * @copilot/uploads — evidence upload + document-vision ingestion (M4).
 *
 * Immutable `UploadRecord` (ledger) + mutable `UploadAnalysisRecord` (state
 * machine). Bytes live in an object store behind `UploadStorageAdapter`, never
 * in Postgres. `DocumentVisionAdapter` is a deterministic mock by default — no
 * paid call unless an operator explicitly opts in. Low-confidence extraction is
 * never silently promoted to VERIFIED evidence.
 */
export * from './storage.js';
export * from './vision.js';
export * from './analysis-store.js';
export * from './pipeline.js';
