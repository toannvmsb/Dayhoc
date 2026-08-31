# Security, Privacy & Retention — Pilot

> Phase 10 hardening. Some items need anh's confirmation (P-05 in `PENDING_APPROVAL.md`).

## Roles & access (enforced in `@copilot/api`)
- **Parent / Teacher tokens** are scoped to their family — a request for a child
  outside `familyUserIds` is a 403.
- **Child token** is scoped to exactly one child, may reach ONLY child-safe
  endpoints, and every child response additionally passes `assertChildSafe`
  before leaving the process (defense in depth on top of the type-level
  guarantee). A child token cannot write evidence directly.
- Child access = **PIN per child** (design + spec). Confirm P-03.

## Evidence & auditability
- `evidence`, `ai_inferences`, `teacher_contributions`, `uploads` are
  **append-only** — BEFORE UPDATE/DELETE triggers raise regardless of caller.
- Every parent-facing recommendation is traceable via `@copilot/audit`
  (`traceGap` / `tracePrescription` / `tracePlanAction`) back to the deterministic
  rule + the raw evidence records + any AI inference ids involved.
- AI never mutates mastery / gap / prerequisite state. AI output is validated
  against a versioned schema before the engine sees it (`@copilot/ai`
  `runStructured`); invalid output returns issues, not a value.

## AI cost / latency
- Every AI call records `{provider, model, operation, tokenIn, tokenOut,
  latencyMs, costUsd, confidence, schemaValid}` to the observability cost sink
  and a full `ai_inferences` provenance row.
- Pricing per provider is config (`ProviderPricing`); budget alerting is a sink
  concern (wire to the metrics backend at deploy).

## Child data — retention & erasure
- Child PII is consent-gated; no public profile.
- **Hard-deleting a child** cascades into `evidence`, which the append-only
  trigger blocks by design. Erasure for a retention/legal request runs as a
  privileged operation that suspends triggers for the transaction
  (`SET session_replication_role = replica`) — to be built as an audited admin
  procedure in ops, not exposed in the app. Confirm legal requirements (P-05).
- Derived state (twin / gaps / plans) is fully recomputable and carries no
  independent record — deleting the evidence removes the child's learner state.

## Secrets
- All secrets via env (`.env`, gitignored); `.env.example` is the template.
- No secrets in source, logs, URLs, or client bundles.

## Observability
- Structured JSON logs (`@copilot/observability` `createLogger`), one object per
  line, sink-agnostic. Evidence writes and AI calls are logged with ids for
  correlation.
