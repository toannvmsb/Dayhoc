/**
 * @copilot/schemas — Zod schemas for every system boundary + AI I/O contracts.
 * Untrusted data (HTTP, AI output, storage, jobs) must pass through here first.
 */
export * from './validate.js';
export * from './evidence.schema.js';
export * from './teacher-contribution.schema.js';
export * from './ai-classification.schema.js';
