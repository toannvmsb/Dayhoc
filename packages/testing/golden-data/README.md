# Golden datasets — `@copilot/testing`

Synthetic golden fixtures that exercise the deterministic education engine with
**real curriculum + real learner trajectories**, not hand-written schema stubs.
All data is invented for automated testing — no real student data.

| Folder | Source zip | What it drives |
|---|---|---|
| `test/` | Golden Test Dataset v1.0 | 120 questions + 12 student profiles — skill-ID mapping gate |
| `error/` | Golden Error Dataset v1.0 | 360 error cases + 15 curated — `classifyErrorSignature` |
| `twin-planner/` | Golden Learning Twin & Planner v1.0 | 48 profiles · 912 evidence events — full pipeline |
| `e2e/` | Golden E2E Family Journey v1.0 | 24 journeys · 15 failure scenarios · 15 invariants |

## `twin-planner/` — `golden/twin-planner.test.ts`

For each of the 48 profiles the test runs the whole chain
`events → Evidence[] → Learning Twin → Gap Engine → Readiness → Learning Mix → Daily Plan`
(mapper + runner in `golden/twin-planner-pipeline.ts`).

Coefficients are provisional (Decision **P-02**) and the dataset's `mastery_score`
spans a full 0–100 range, so the suite is **invariant-driven, not exact-match**:

- **Hard invariants, 48/48** — plan never exceeds the time budget · twin has no
  global grade/level · twin is an order-independent projection of the append-only
  stream · hinted success never lifts mastery above the unaided rebuild.
- **Per-profile `required_invariants`** — each profile's declared invariants must
  hold (0 failures).
- **Directional gates** — archetype fingerprint ≥ 80 % · strong-vs-weak mastery
  separation (mean gap > 20) · clearly-strong/weak skills land in a compatible
  band ≥ 80 %.
- **Exact** — the base `error_signature → gap_type` map reproduces the dataset for
  all 912 events.

## `e2e/` — `golden/e2e-journey.test.ts`

- Schema + referential integrity across all 24 `family ↔ journey ↔ twin-profile`
  links (100 %).
- The 5 canonical checkpoint milestones (`after_first_scan` … `final_day`) —
  context initialised, plan skill-specific + within budget + every action states
  its reason, every gap names a concrete root skill (not "weak at maths"), gap
  state follows evidence confidence.
- The 15 `E2E_INVARIANTS.yaml` invariants over a representative pipeline run.
- The child-projection boundary (`FAIL-12`) via the real role-gated `createApi`.
- All 15 `FAIL-*` failure-recovery scenarios mapped to engine / ledger assertions.

## Deferred to pilot calibration (P-02), **not** logic bugs

- A single unverified wrong attempt drives `mastery → 0` and surfaces a
  `concept_gap`; the dataset's model keeps such sparse evidence near a neutral
  prior with low confidence (`gap_state: none_or_low_priority`). ~12/663
  skill×profile mastery points differ for this reason. Tune sparse-evidence
  sensitivity once pilot data exists.

## Regenerating derived KB data

The math KB these tests load is built from `packages/math-data/data/dev-core/`
via `npm run data -w @copilot/math-data`.
