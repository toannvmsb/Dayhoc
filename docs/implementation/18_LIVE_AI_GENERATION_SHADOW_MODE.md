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
