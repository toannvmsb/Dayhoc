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
