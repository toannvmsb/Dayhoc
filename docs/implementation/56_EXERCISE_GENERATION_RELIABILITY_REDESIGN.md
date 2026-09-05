# 56 — Exercise Generation Reliability Redesign

> **STATUS: CHECKPOINT — architecture built + tested with the mock generator and
> fake adapters. NO paid model call has been made. Awaiting anh's approval
> before the paid 20+ case benchmark (this document, §13).**

The last live result (1/5 clean for gpt-4o-mini on 8‑item batches) is not
accepted for production, and prompt-tuning gpt-4o-mini is stopped. The observed
failures were two separate classes — (A) semantic / reference-copying and
(B) schema/contract (missing `origin`, empty `requiredSkillIds` on large
batches). Both are fixed architecturally here, before any model is chosen.

Everything below is implemented, builds clean, and is covered by 27 new tests
(`packages/exercise-gen/src/item-pipeline.test.ts` +
`packages/testing/src/benchmark/item-generation-benchmark.test.ts`); full suite
**678 pass / 42 skip / 0 fail**, web + mobile typecheck clean.

---

## A. Architecture changes

The C5 batch pipeline (one call → a whole worksheet, model echoes every
deterministic field) stays in the tree for the existing shadow-mode wiring, but
a **new item-level pipeline** is now the recommended path:

```
ExerciseGenerationSpec  (unchanged — still the education authority)
        │  deterministic
        ▼
buildItemGenerationSpecs()   → ItemGenerationSpec[]      (§1 — one per worksheet slot,
        │                                                 EXACT K/T, answer family,
        │                                                 problem structure, requiredSkillIds,
        │                                                 curriculum-safety facts)
        ▼
buildProblemDNA()            → ProblemDNA per item        (§5 — de-anchored grounding:
        │                                                 structure + difficulty semantics +
        │                                                 number range + forbidden similarities;
        │                                                 NO raw reference wording)
        ▼
ItemContentGenerator.generate({ problemDNAs: 1–2 })       (§2/§3/§4 — CONTENT ONLY,
        │   (bounded parallelism, 1 or 2 items per call)   strict JSON schema, no union)
        ▼
composeExercise(itemSpec, content)                        (§1/§2 — deterministic re-assembly:
        │                                                 authority fields copied verbatim,
        │                                                 answer string coerced to pinned kind)
        ▼
acceptItem()  → HARD gate, no partial bypass              (§10 — schema ∧ skill ∧ curriculum ∧
        │                                                 prereq ∧ answer ∧ similarity ∧
        │                                                 uniqueness ∧ K ∧ T)
        ▼
regenerate ONLY failed items (bounded, one stronger       (§4/§11)
   fallback) — accepted items are never discarded
        ▼
GeneratedExerciseBatch (accepted items, worksheet order) + per-item + cost trace
```

New files (`@copilot/exercise-gen` unless noted):

| file | role |
|---|---|
| `@copilot/domain/exercise-gen.ts` (added) | `ItemGenerationSpec`, `GeneratedItemContent`, `ProblemDNA`, `AnswerKind`, `ProblemStructure`, `AnswerVerificationPolicy`, `ItemAcceptanceGate`/`ItemAcceptanceResult` |
| `@copilot/schemas/generated-item-content.schema.ts` (new) | reduced-output Zod schema + **strict** JSON Schema (no `oneOf`/`anyOf` union) + `normalizeGeneratedItemContentPayload` |
| `item-spec.ts` | `buildItemGenerationSpecs` — deterministic per-item contract |
| `problem-dna.ts` | `buildProblemDNA` — de-anchoring; `extractNumbers`/`extractProperNouns`/`templateSkeleton` helpers |
| `similarity-gate.ts` | `checkItemSimilarity` — deterministic, model-independent, multi-signal |
| `compose.ts` | `composeExercise` — deterministic answer coercion + authority re-attachment |
| `item-generator.ts` | `ItemContentGenerator` port (1–2 items/call) |
| `mock-item-generator.ts` | deterministic offline generator (test double + fallback) |
| `luna-item-generator.ts` | live generator over `AIProviderAdapter`, strict structured output |
| `item-validator.ts` | `acceptItem` — the hard gate |
| `item-routing.ts` | `selectGeneratorForAttempt` — default → retry → stronger fallback; never tier→model |
| `item-orchestrator.ts` | `orchestrateItemGeneration` — the bounded state machine |
| `item-metrics.ts` | `aggregateItemQuality` + `evaluateItemQualityGates` (doc 56 §9 metrics) |
| `@copilot/testing/benchmark/item-generation-benchmark.ts` (new) | `buildItemBenchmarkSpecs` (26 specs), `runItemBenchmark`, `estimateItemBenchmarkCalls`, `formatItemBenchmarkReport` |

---

## B. Fields removed from AI responsibility

The model now returns **only**: `prompt`, `answer` (a plain string), optional
`distractors` (choice only), `hints` (6), `workedSolution`, optional `rubric`
(reasoning only), and the echoed `itemId`.

Everything else is populated by deterministic application code and copied into
the final `GeneratedExercise` by `composeExercise` — the model never sees or
sets any of:

`generationSpecId` · `skillId` · `requiredSkillIds` · `supportingSkillIds` ·
`targetRole` · `bucket` · `knowledgeLevel` (K) · `thinkingLevel` (T) ·
`problemTypeId` · `curriculumNodeId` / curriculum node · `origin` ·
frontier decision · prerequisite decision · answer-verification policy ·
K/T range or distribution.

K and T are pinned to an **exact** level per item inside the spec's range
(`item-spec.ts` `pinLevels`, honouring `stretchRatio`), so "the model picked K4"
is not a possible failure any more.

---

## C. Structured Output implementation

- `GENERATED_ITEM_CONTENT_JSON_SCHEMA` is a flat object — `answer` is always a
  `string`, so there is **no discriminated union** and the schema is valid for
  provider-native `response_format: { type: "json_schema", strict: true }`.
  (The C5 batch schema's `answerSpec` `oneOf` is what OpenAI rejected in strict
  mode; pinning the answer kind deterministically removes the union entirely.)
- `luna-item-generator.ts` requests `STRICT_JSON_SCHEMA` by default; the adapter
  downgrades + reports `JSON_OBJECT_FALLBACK` if the model can't do strict.
- Strict mode requires every property in `required` + `additionalProperties:
  false`; the two optional fields are expressed as nullable-and-required and
  `normalizeGeneratedItemContentPayload` maps `null`/`""` → absent before the
  Zod parse.
- **Schema-valid is never treated as educationally valid** — `acceptItem` runs
  the full semantic gate after the Zod parse (§10).

---

## D. 1 / 2-item generation implementation

- `ItemContentGenerator.generate({ problemDNAs })` takes **1 or 2** DNAs. The
  Luna generator refuses > 2; the mock slices to 2.
- `orchestrateItemGeneration` config: `itemsPerCall: 1 | 2`, `maxConcurrency`
  (default 3), `maxRetriesPerItem` (default 2), `escalateAfterAttempts`.
- **8-item single-call generation is gone.** The benchmark modes are
  `A_1_PER_CALL` and `B_2_PER_CALL` only.
- Item specs are built deterministically first; generation calls are chunked and
  run with bounded parallelism.
- **Acceptance is a sequential pass in worksheet order** after each round, so
  the within-worksheet uniqueness / similarity check is deterministic (the
  accepted-siblings set grows one item at a time).
- **A failed item never discards a good one** — only unaccepted items are
  regenerated; `maxRetriesPerItem` bounds the loop; one stronger fallback is
  tried after `escalateAfterAttempts`.
- `maxTokens` per call is small (3500) because a call is only 1–2 items — this
  alone removes the truncation failure mode that hit 8-item gpt-4o batches.

---

## E. ProblemDNA design

`buildProblemDNA(itemSpec, kb, referenceExamplesForSkill)` — deterministic,
`dnaHash` stable. Contents:

- `skill` — id, name, domain, description (the skill IS grounding; it's already
  deterministic)
- `problemStructure` — one of 8 (`direct_computation`, `single_step_word_problem`,
  `multi_step_word_problem`, `compare_and_decide`, `work_backwards`,
  `explain_or_justify`, `find_the_error`, `construct_an_example`)
- `operationStructure` — coarse operation vocabulary from domain + structure
- `difficulty` — K/T levels **with their grade-agnostic meaning strings**
- `thinkingRequirement` — a Vietnamese sentence for the T level
- `answerKind` — the pinned family
- `constraints` — language `vi`, SGK notation, 6 hint rungs, age-appropriate,
  **`numberRange`** (observed from references when available, else K-level default)
- `allowedVariationAxes` — the 5 axes the generator may vary (scenario, numbers,
  question framing, order of givens, characters)
- `forbiddenSimilarities` — derived from the reference examples, **abstract not
  raw**: `scenarios` (context nouns + names), `numberTuples` (the number
  multisets), `templateSkeletons` (numbers + names + swappable nouns blanked)
- `styleHints` — abstract ("đề ngắn 1 câu" / "lời văn 2–3 câu"), never a quote
- `rawReference` — **null by default.** Raw reference text is attached ONLY via
  an explicit `rawReferenceJustification(spec) => string` callback, and then it
  carries `leakageRisk: 'ELEVATED'`. No code path in the redesign sets it.

The Luna system prompt is told to vary only along `allowedVariationAxes` and
never reproduce anything in `forbiddenSimilarities`. It is not shown a single
reference prompt.

---

## F. Similarity / leakage validator

`checkItemSimilarity({ prompt, references, worksheetSiblings, recentItems?,
prohibitedNumberTuples? })` — deterministic, **operates with no reference to
the model**, no tunable exposed to prompt or config.

Signals (each yields `PASS` / `NEAR` / `COPY`, worst wins):

| signal | fires on |
|---|---|
| `exact_copy` | whitespace-collapsed equality |
| `near_copy` | digit-normalized equality (word problems) / content-signature equality (bare computations) |
| `template_match` | skeleton equality (numbers + proper nouns + swappable content nouns blanked) — catches "An có 5 quả táo" → "Lan có 8 quả cam" |
| `token_jaccard` | word-set overlap ≥ 0.7 → COPY, ≥ 0.5 → NEAR |
| `trigram_dice` | char-trigram Dice ≥ 0.75 → COPY, ≥ 0.6 → NEAR |
| `number_tuple_identical` | same sorted number multiset (COPY when also lexically similar or on the DNA forbidden list, else NEAR) |
| `proper_noun_overlap` | name/place Jaccard ≥ 0.6 |

Compared against: the reference examples the item was grounded on, the other
items already accepted in the same worksheet, and (optional) recent items for
that child. A lexical-content floor skips the structural signals for a bare
`Tính: a + b` (a worksheet legitimately has many). `acceptItem` rejects `COPY`
and `NEAR` against a reference or a sibling.

---

## G. Deterministic answer validation status

Preserved and wired in as a hard gate:

- `math-verifier.ts` (unchanged) — exact bigint-rational recompute for closed
  arithmetic; `CORRECT` / `INCORRECT` / `UNSUPPORTED`, never a guess.
- `answer-verification.ts` (unchanged) — honest levels
  (`DETERMINISTIC_CORRECTNESS_VERIFIED` / `FORMAT_VERIFIED` /
  `AI_CROSSCHECK_REQUIRED` / `UNVERIFIED`).
- `item-spec.ts` sets `answerVerificationPolicy` per item:
  `DETERMINISTIC_EXPECTED` for a `direct_computation` numeric item (a "supported
  math type" — correctness is a hard gate), `AI_OR_HUMAN_CROSSCHECK` otherwise.
- `acceptItem` ANSWER_VERIFIED gate: a malformed key fails; a **proven-wrong**
  (`INCORRECT`) answer fails regardless of policy; a `DETERMINISTIC_EXPECTED`
  item that the verifier can't confirm fails; a crosscheck-policy item is
  accepted at its honest level and never reported as deterministically correct.

---

## H. Unit / golden test results

`packages/exercise-gen/src/item-pipeline.test.ts` (22) + `.../benchmark/
item-generation-benchmark.test.ts` (5) — all green. Coverage:

- `buildItemGenerationSpecs`: exact count, bucket match, K/T pinned in range,
  requiredSkillIds real + in-spec, deterministic, prereq-repair at K floor.
- `buildProblemDNA`: never carries raw reference text; carries structure /
  difficulty / number range / forbidden similarities; raw only with explicit
  justification; stable hash.
- `checkItemSimilarity`: verbatim → COPY; numbers-only mutation → COPY;
  name+noun swap of the same template → COPY; genuinely different scenario →
  PASS; prohibited number tuple → COPY.
- `composeExercise`: numeric/fraction/choice/reasoning coercion; rejects a
  non-numeric answer for a numeric item; rejects a 2-rung hint ladder.
- `orchestrateItemGeneration` (mock): MODE A delivers a full worksheet with one
  call per item; MODE B delivers with ~half the calls; every accepted item
  independently passes `acceptItem`; deterministic across runs; a copy-happy
  generator is caught and the run recovers via the stronger fallback with the
  good items kept — **no copy ever reaches the batch**.
- Benchmark manifest: ≥ 20 specs, grades 4 + 7, all required axes; deterministic
  call-count estimate; spend guardrail stops before the ceiling.

**Mock baseline over the full 26-spec manifest** (deterministic generator, zero
retries, no real fallback — a floor, not a target):
`schema 100% · skill 100% · K 100% · T 100% · curriculum 100% ·
answer-correctness 100% · uniqueness 100% · leakage 91.9% · final acceptance
88.1%`. The mock's ceiling is its fixed ~28-template pool colliding with
reference examples on 16-item worksheets — a real model varies scenarios freely.
The gates biting even a deterministic mock is the point: they are real.

---

## I. Proposed paid benchmark call count

`buildItemBenchmarkSpecs()` = **26 specs / 260 questions** — HC01–HC10
(frontier / T4–T5 / gap repair / estimated context) + 16 golden LT profiles
(realistic G4 + G7 current-curriculum). Axes covered: `basic_current`,
`gap_repair`, `thinking`, `frontier_advanced`, `application`; grades 4 (10) and
7 (16).

Models: **gpt-4o-mini, gpt-4.1-mini, gpt-5-mini** + **gpt-4o as control** = 4.
Modes: **A (1/call)** and **B (2/call)**. `maxRetriesPerItem: 2`.

`estimateItemBenchmarkCalls` (deterministic):

| | value |
|---|---|
| requested items (26 specs × 4 models × 2 modes) | **2 080** |
| model calls — no retries (min) | **1 560** |
| model calls — every item retries twice (max) | **5 720** |
| realistic expectation (≈ 15–30% items need 1 retry) | **~2 000–2 600** |

Per call ≈ 1 000–1 400 input tokens (system prompt + 1–2 ProblemDNAs) and
≈ 250–700 output tokens (1–2 items).

## J. Maximum estimated benchmark cost

Using public list prices (to be entered into `PricingRegistry` before the run —
a deliberate gate; the registry currently has only the fictional
`gpt-5.6-*` entries):

| model | in $/1M | out $/1M | est. cost @ min calls | est. cost @ max calls |
|---|---|---|---|---|
| gpt-4o-mini | ~0.15 | ~0.60 | ~$0.20 | ~$0.70 |
| gpt-4.1-mini | ~0.40 | ~1.60 | ~$0.50 | ~$1.80 |
| gpt-5-mini | ~0.25 | ~2.00 | ~$0.50 | ~$1.90 |
| gpt-4o (control) | ~2.50 | ~10.0 | ~$3.10 | ~$11.0 |
| **total** | | | **~$4.30** | **~$15.4** |

**Proposed hard ceiling: `maxCostUsd: 8` for the full run**, with the
`runItemBenchmark` spend guardrail stopping before it. **Smoke first**
(doc 56 §12): 2 models (gpt-4o-mini + gpt-4.1-mini) × MODE A × 6 specs ≈ 60–90
calls ≈ **< $0.30** — if schema assembly, the similarity gate, or item-level
generation are broken, this stops it before the full spend.

---

## STOP — approval needed before any paid call

Per the redesign brief §13: **no paid benchmark call will be made until anh
approves this checkpoint.** On approval the sequence is:

1. add the 4 real model prices to `PricingRegistry` (effective-dated);
2. run the smoke (< $0.30), confirm the architecture end-to-end on real output;
3. if green, run the full 26-spec × 4-model × 2-mode benchmark under
   `maxCostUsd: 8`;
4. report per-model/per-mode metrics with **cost per accepted item** as the
   primary figure, subject to the §10 quality thresholds, and recommend a
   default model + routing.

Do **not** conclude gpt-4o-mini is insufficient until step 3 has run against
this architecture.
