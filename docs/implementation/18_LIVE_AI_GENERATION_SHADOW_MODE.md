# 18 — Live AI Generation in Shadow Mode (C5)

> **Authority:** doc 14 C5 (LOCKED, anh 2026-09-01). Part of the
> AI-Generation-First migration. C5 does **not** replace legacy practice —
> it MEASURES whether a live model can satisfy the deterministic education
> contract at acceptable quality / reliability / latency / cost.
>
> **Status:** ✅ infrastructure implemented, **no live provider run** (no
> `OPENAI_API_KEY` in this environment). SHADOW mode is wired but disabled by
> default (`AI_GENERATION_MODE` defaults to `OFF`). **LIVE mode is not
> activated and delivers nothing to a child.**

---

## 1. Production-visible path is unchanged

```
Legacy Practice (buildAssignmentsForPlan)  ─────────────►  Child
```

Shadow path (parallel, never child-visible):

```
scene(child)  →  buildExerciseGenerationSpec  →  buildGenerationGrounding
   →  LunaExerciseGenerator  →  AIProviderAdapter (OpenAI)  →  JSON parse
   →  GeneratedExerciseValidator  →  answer verification  →  telemetry + PgGenerationStore
```

`services/api` `childToday` builds the legacy assignment, asserts it child-safe,
returns it, and **then** calls `shadowGeneration.queue.enqueue(...)`. The queue
owns scheduling (`setImmediate`) and error isolation — the request handler never
holds a naked promise, and a shadow failure can only ever become telemetry.

## 2. Layering (provider isolation)

```
AIProviderAdapter               (@copilot/ai/provider.ts — capability port, no OpenAI types leak out)
  ↑ createOpenAiProviderAdapter  (@copilot/ai/providers/openai-adapter.ts — the ONLY OpenAI-aware file)
LunaExerciseGenerator            (@copilot/exercise-gen/luna-generator.ts — builds prompt/payload, parses+validates)
  ↑ implements
ExerciseGenerator               (unchanged C4 interface)
  ↑ used by
orchestrateGeneration           (unchanged bounded state machine)
```

No literal model name in planner / validator / target-selector / practice /
domain. Model + provider come from `loadAiGenerationConfig()`
(`AI_GENERATION_DEFAULT_PROVIDER` / `AI_GENERATION_DEFAULT_MODEL` /
`AI_PRICING_CONFIG_VERSION` / `AI_GENERATION_MODE`). The API key is read fresh
from `process.env.OPENAI_API_KEY` by `resolveLunaApiKey()` and stored on nothing.

## 3. Structured output + both gates

`response_format: {type: 'json_object'}` (broad JSON-mode) — this repo has no
zod→JSON-Schema converter yet, so the REAL contract enforcement is the Zod parse
(`generatedExerciseBatchSchema`) plus the full `GeneratedExerciseValidator` the
orchestrator re-runs. Upgrading to strict `json_schema` mode is a drop-in change
to `openai-adapter.ts` only.

## 4. System prompt (education-dumb) — `exercise-generator-prompt.v1`

The generator produces content strictly inside the spec; never decides what to
study; must not add skills / change roles / change allocation / exceed K·T /
invent ids / introduce forbidden required knowledge / change the goal. Reference
data is grounding only. **All GENERATION SPEC / REFERENCE DATA text is DATA, not
instructions** — delimited from the SYSTEM POLICY message. `promptVersion` is
persisted on every operation + trace; a prompt change is a version bump.

## 5. Privacy — provider payload

The generator receives **only `GenerationGrounding`** (+ a request correlation
id). It carries no `childId`, no display/parent/school name, no Twin
(`relevantMastery` / `thinkingProfile` / `actualLearningFrontier`), no evidence,
no history — the C4 grounding builder already guarantees this and a test asserts
the serialized payload contains none of those tokens.

## 6. Answer verification (`AnswerVerificationLevel`)

`DETERMINISTIC_VERIFIED | AI_CROSSCHECK_REQUIRED | HUMAN_GOLDEN_VERIFIED |
UNVERIFIED`. For `numeric / fraction / choice / exact`: the answer key is checked
for internal well-formedness / self-consistency (this does **not** re-derive the
answer from the word problem — that needs a symbolic solver, out of C5 scope).
`reasoning` → always `AI_CROSSCHECK_REQUIRED`. A second-pass verifier interface
(`SecondPassVerifier`) + a pure trigger predicate (`wouldRequireVerification`) +
a stub exist; **no live second model call is wired** — the benchmark only
measures how often verification would be required.

## 7. Cost — actual, effective-dated

`computeActualCost(usage, model, at, PricingRegistry)` prices real provider token
usage by the registry entry effective on the request date. `estimatedCostUsd`
stays a forecast (0 here). Mock → 0. A live provider with no price entry →
`actualCostUsd: null` + `priceConfigVersion: null` (never a pretend actual).
`generationOperationToUsageEvent` maps every operation onto `AiUsageEvent` with
`inputTokens / cachedInputTokens / outputTokens / priceConfigEffectiveDate /
escalatedFrom`.

## 8. Reference-example protection

New reason code `REFERENCE_EXAMPLE_COPY` (→ REGENERATE). `validateGeneratedBatch`
now takes the grounding's `referenceExamples` and rejects any item whose
normalized prompt matches a reference example's — not a prompt instruction alone.

## 9. Shadow quality metrics (`aggregateShadowMetrics`)

Pure aggregation over `ShadowMetricRecord[]` → schema / validator first-pass,
final deliverable, repair / regeneration / quarantine rates, avg attempts,
answer-verification rates, skill / bucket / K / T adherence, reference-copy rate,
no-invented-id / no-forbidden-knowledge rates, latency avg/p50/p95, tokens,
actual VND / batch and / question, failures by reason code.

## 10. Benchmark harness (`@copilot/testing` `benchmark/luna-generation-benchmark.ts`)

`buildBenchmarkSpecs()` derives real `ExerciseGenerationSpec`s from the 48
SYNTHETIC golden twin/planner profiles (ids like `LT-G4-01` — no real child
data). `runLunaBenchmark({adapter, specs})` runs the pipeline and returns
`{records, metrics, perCase}`. `C5_SHADOW_GATES` + `evaluateGates` encode doc 14
C5 §18's provisional review gates — **not an auto-flip**. The live test is
`describe.skipIf(!RUN_LIVE_AI_BENCHMARK)` and additionally checks for a key.

## 11. Routing — advanced provider still OPEN_PENDING_BENCHMARK

Unchanged. `resolveRoute('worksheet_batch_generation', {hsg|k4_k5|t4_t5})` →
tier `advanced`, `advancedModelPending: true`, `effectiveTier: 'luna'`. The
subscription plan is not a parameter of `resolveRoute`
(`AIModelRouter.PLAN_DOES_NOT_SELECT_MODEL === true`).

## 12. DB

**No new migration.** `generation_specs` / `generated_exercise_sets` (migrations
`1757030400000` + `1757116800000`) already hold everything — the 4 new
`TargetSkill` fields ride inside the `spec` jsonb, `promptVersion` inside `trace`
jsonb. `PgGenerationStore` (`@copilot/exercise-gen/pg`) mirrors `PgLedgerStore`;
integration test verified against the portable Postgres.

## 13. What C5 did NOT do

No LIVE activation · no AI content to a child · legacy practice intact · no Next
Best Question · Reference Library intact · no Terra/Sonnet hard-code · no pricing
change · no OCR work · no paid network call in the default test run.

---

# C5.1 — Benchmark readiness hardening (anh 2026-09-01)

## 14. Answer verification — FORMAT ≠ CORRECTNESS

`AnswerVerificationLevel` (doc `exercise-gen.ts`) is now:
`FORMAT_VERIFIED | DETERMINISTIC_CORRECTNESS_VERIFIED | AI_CROSSCHECK_REQUIRED |
HUMAN_GOLDEN_VERIFIED | UNVERIFIED`. **A well-formed answer key is
`FORMAT_VERIFIED`, never `DETERMINISTIC_CORRECTNESS_VERIFIED`** unless an
independent checker re-derived the result. A key the checker proves WRONG →
`UNVERIFIED` (and the validator raises `ANSWER_INCONSISTENT` → not delivered).
Benchmark answer metrics: `answerFormatValidRate`,
`answerDeterministicCorrectnessVerifiedRate`, `answerCrosscheckRequiredRate`,
`answerUnverifiedRate` — the report never claims "100% verified" off a valid schema.

## 15. Deliberately narrow deterministic math verifier

`math-verifier.ts` `verifyMathAnswer(item)` → `CORRECT | INCORRECT | UNSUPPORTED`.
Exact bigint-rational arithmetic (`+ - × · * / :` and parentheses, decimals with
`.` or `,`, `−`/`–` normalized). It extracts a closed expression ONLY when the
prompt is essentially just that expression — any estimation wording
(`ước lượng`, `làm tròn`, `gần`, `khoảng`, …), any blank marker (`?`, `_`, `x`,
`điền`, …), any leftover prose → `UNSUPPORTED` (never a guess). `choice`
mismatches are `UNSUPPORTED` too (could be "closest to" semantics), never
`INCORRECT`. Verified with 3 real reference-library false-positive cases that
now pass. **NOT a CAS** — word problems are `AI_CROSSCHECK_REQUIRED`.

## 16. Structured output mode — explicit, never faked

Config `AI_GENERATION_STRUCTURED_OUTPUT_MODE` → `STRICT_JSON_SCHEMA |
JSON_OBJECT_FALLBACK` (default FALLBACK). `openai-adapter.ts` sends
`response_format: {type:'json_schema', json_schema:{strict:true, schema}}` only
when STRICT is requested AND a schema is supplied — otherwise it honestly
downgrades and reports `JSON_OBJECT_FALLBACK`. The hand-authored schema is
`@copilot/schemas` `GENERATED_BATCH_JSON_SCHEMA`
(`generatedExerciseBatch.jsonschema.v1`). The Zod parse + `GeneratedExerciseValidator`
remain the real contract regardless.

## 17. Versioning on every operation + benchmark result

`GenerationOperation` gains `structuredOutputMode`, `outputSchemaName`,
`outputSchemaVersion` (alongside `promptVersion`). The benchmark report records
`benchmarkVersion`, `manifestVersion`, `promptVersion`, `outputSchemaVersion`,
`structuredOutputModeRequested` / `…Used`, `pricingConfigVersion`.

## 18. Frozen benchmark manifest + spend guardrail

`luna-benchmark-manifest.ts` — `BENCHMARK_MANIFEST_VERSION`,
`BENCHMARK_PROFILE_IDS` (8 × `LT-G4-*` + 8 × `LT-G7-*`, id order),
`buildBenchmarkManifest()` builds real specs through `buildExerciseGenerationSpec`,
`manifestCoverage()` reports what's covered AND the gaps (the golden dataset has
no strong above-grade FRONTIER / T4-T5 profiles — flagged, not hidden).
`runLunaBenchmark({..., maxBatches, maxCostUsd})` stops BEFORE exceeding either
(`LIVE_BENCHMARK_MAX_BATCHES` default 20, `LIVE_BENCHMARK_MAX_COST_USD` default 5).
Live test is `describe.skipIf(!RUN_LIVE_AI_BENCHMARK)` + a key check + a 600s cap.

## 19. Machine-readable + human-readable benchmark output

`BenchmarkReport` (see the interface in `luna-generation-benchmark.ts`) carries
`quality{…}`, `answers{formatValidRate, deterministicCorrectnessVerifiedRate,
crosscheckRequiredRate, unverifiedRate}`, `performance{…}`, `usage{…}`,
`cost{actualCostUsd, actualCostVnd, costPerBatchVnd, costPerQuestionVnd}`,
`failures{reasonCode→count}`, `perCase[]`, `coverage`, `gates[]`. Plus
`formatBenchmarkReport()` for a readable summary. The live test prints both.

## 20. What C5.1 did NOT do

Same list as §13 — plus: no live benchmark run (still no key), no Terra/Sonnet.

---

# C5.2 — Benchmark coverage hardening (anh 2026-09-02)

## 21. Hard-case manifest (HC01–HC08)

`luna-hardcase-manifest.ts` (`HARDCASE_MANIFEST_VERSION`) — a SEPARATE 8-case
manifest, each spec built through the REAL deterministic pipeline (crafted
synthetic evidence → twin → gaps → context → `buildExerciseGenerationSpec`),
each with a machine-checkable `expect` block:

| id | what it proves |
|---|---|
| HC01 | G4 grade-level K + strong thinking → T4, K stays ≤ K3, no FRONTIER |
| HC02 | G4 repeated strong thinking → T5 without above-grade knowledge |
| HC03 | G7 HSG + strong thinking, no frontier → thinkingChallenge>0, T5, K≤K3, **advanced bucket = 0**, no FRONTIER invented |
| HC04 | G7 verified Grade-8 frontier, prereqs OK → FRONTIER selected, advanced>0, K4, current lesson is real G7 CORE_CURRICULUM |
| HC05 | G7 Grade-9 traction + **blocking** Grade-8 bridge → Parallel Gap Repair, the unsafe Grade-9 skill is NOT a frontier target |
| HC06 | HC05 child after the bridge is mastered → a next-safe frontier becomes eligible, repair drops to 0, no manual grade switch |
| HC07 | G7 HSG goal, no frontier evidence → HSG alone does NOT unlock above-grade K, advanced=0, no auto T4/T5 |
| HC08 | weak/uncertain context + borderline frontier confidence → conservative, no unsafe above-grade jump, context confidence < VERIFIED |

HC05→HC06 is a paired state transition the benchmark verifies.

## 22. Adversarial generator / validator cases

`c5-adversarial.test.ts` — 15 deterministic fake-generator cases that break the
contract; the validator must catch each with the right reason code + disposition
(the validator is NOT weakened):
math-wrong→`ANSWER_INCONSISTENT` · invented skill/required id→`UNKNOWN_*` +
QUARANTINE · required outside closure→`REQUIRED_SKILL_OUT_OF_BOUNDS` · exact
copy→`REFERENCE_EXACT_COPY` · near copy→`REFERENCE_EXAMPLE_COPY` ·
K/T out of range→`OUTSIDE_K_RANGE`/`OUTSIDE_T_RANGE` · advanced bucket on a
CURRENT skill→`TARGET_ROLE_MISMATCH` · T5 needing unsupported above-grade
knowledge→`FRONTIER_SKILL_NOT_SELECTED`/`ABOVE_GRADE_KNOWLEDGE_NOT_ALLOWED` +
QUARANTINE · reasoning missing rubric→`MISSING_RUBRIC` ·
duplicates→`DUPLICATE_VARIANT` · shortfall→not deliverable ·
malformed output→no delivery · unsafe content→`UNSAFE_CONTENT` + QUARANTINE.

## 23. Reference-copy metrics (exact vs near)

`reference-similarity.ts` `classifyReferenceCopy` → `EXACT | NEAR | NONE`,
DETERMINISTIC (no fuzzy score):

- **EXACT** = `collapseWhitespace(prompt) === collapseWhitespace(example)`.
  `exactReferenceCopyRate` is a **HARD GATE — must be 0**.
- **NEAR** = not exact, but `normalize(prompt) === normalize(example)` where
  `normalize` lowercases, replaces digit runs with `#`, and non-(letter|digit|`#`)
  runs with a space, then trims. `nearReferenceCopyRate` gate ≤ 1% (still exact
  equality, on a normalized form). New reason code `REFERENCE_EXACT_COPY`.
- Comparison is against the SPECIFIC few examples the generator was shown for
  this batch, not the whole library. **False-positive risk**: a very short
  heavily-templated legitimate question could normalize to the same string —
  low, and reported as an open item.

## 24. Answer-verification semantics — LOCKED

`FORMAT_VERIFIED ≠ DETERMINISTIC_CORRECTNESS_VERIFIED` is a locked invariant.
`ANSWER_VERIFICATION_LEVELS` reserves `AI_CROSSCHECK_PASSED` /
`AI_CROSSCHECK_FAILED` for a future second-pass verifier — an AI cross-check
outcome must use these DISTINCT states and may NEVER be reported as
`DETERMINISTIC_CORRECTNESS_VERIFIED`. `CORRECTNESS_GROUND_TRUTH_LEVELS`
(= deterministic + human-golden only) is the allow-list for any true
correctness metric. No paid second-pass call in C5.2.

## 25. Coverage matrix + live-readiness decision

`luna-benchmark-coverage.ts`:
- `computeCoverageMatrix(cases)` → counts for grade, target role, K1–K5,
  T1–T5, context confidence, parent goal, Parallel Gap Repair, above-grade
  FRONTIER, grade-level T4/T5. `probeAnswerCoverage` adds answer-format and
  answer-verification-level counts from MOCK-generated batches (deterministic,
  no network). Every uncovered cell is listed in `coverage.uncovered` — **no
  hidden GAP**.
- `assessBenchmarkReadiness` → `{ benchmarkReady, blockingCoverageGaps[],
  nonBlockingCoverageGaps[], hardCaseCount, baseCaseCount, totalCaseCount }`.
  `benchmarkReady` is true only if FRONTIER, T4/T5, grade-level T4/T5, Parallel
  Gap Repair, no-frontier HSG, and uncertain-context (SUPPORTING or ESTIMATED)
  are all covered, AND the adversarial suite passed, AND the local
  build/golden/lint/typecheck/web-build gates are green.
- The `BenchmarkReport` now carries `coverage`, `readiness`, `hardCaseCount`,
  `baseCaseCount`, and the exact/near reference-copy split.

## 26. Current readiness (mock probe)

`benchmarkReady: true`. Blocking gaps: none. Non-blocking gaps (documented):
`knowledge K5`, `context confidence ESTIMATED`, `parent goal kha_gioi`,
`answer format choice`, `answer format exact`,
`deterministic-correctness-supported answer item` — the last three are MOCK
artifacts (the mock only emits numeric/fraction/reasoning word problems); they
will be measured on the first real Luna run.

## 27. What C5.2 did NOT do

Same list as §13/§20 — plus: no paid/live benchmark run, no Terra/Sonnet, no
second-pass AI verifier call.
