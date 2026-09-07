# 68 — SAFE DEGRADED WORKSHEET COMPLETION

> Anh's directive, 2026-09-07. Adopted instead of either "partial delivery" or
> "keep strict" — a third architecture. Core rule: **a failed OPTIONAL
> reasoning/challenge slot must NOT fail an otherwise-safe worksheet; a
> REVIEW/PENDING item must NEVER be counted as delivered to the child.**

## 1. Slot criticality (deterministic, planner-owned)

`SlotCriticality` ∈ `REQUIRED_CORE | OPTIONAL_STRETCH | OPTIONAL_REASONING | CHALLENGE`.
Decided by the **bucket** (`BUCKET_CRITICALITY` in `@copilot/domain`), never by the model:

| bucket | criticality |
|---|---|
| `prerequisiteRepair`, `currentSkill`, `variation` | `REQUIRED_CORE` |
| `application` | `OPTIONAL_STRETCH` |
| `thinkingChallenge` | `OPTIONAL_REASONING` |
| `advanced` | `CHALLENGE` |

`ItemGenerationSpec` gains `criticality` + `fallback: SlotFallbackEnvelope | null`
(`buildItemGenerationSpecs`). A typical 8-slot worksheet = **6 REQUIRED_CORE + 2 optional**.

## 2. REQUIRED_CORE policy

Recovery chain (`worksheet-orchestrator.v2`):
`generate → retry → fallback model → deterministic last-resort (Group A) → SAFE SUBSTITUTE → FAILED`.

A REQUIRED_CORE slot must reach `READY` before delivery. If no path succeeds the
worksheet stays `FAILED`. **An unverified required item is never delivered.**

## 3. OPTIONAL / CHALLENGE policy

If an `OPTIONAL_*` / `CHALLENGE` slot cannot reach `READY` after bounded recovery
it is **`OMITTED`** — routed to the review queue, dropped from the child
worksheet. It never blocks delivery and is never shown unverified. The worksheet
is still `READY` when every REQUIRED_CORE slot is `READY`.

## 4. Group C

`generate → crosscheck`. `PASS → READY`; `FAIL → regenerate/recovery`;
`UNCERTAIN → REVIEW_QUEUE`. `PENDING_CROSSCHECK` is **no longer a child-serving
state**. For `OPTIONAL_REASONING` / `CHALLENGE`: omit if unresolved. For
`REQUIRED_CORE`: safe substitute (a core slot rarely needs crosscheck — most are
kernel-deterministic).

## 5. Safe-substitute envelope (planner-authoritative)

`SlotFallbackEnvelope = { minKnowledgeLevel, minThinkingLevel, allowedProblemStructures, preserveSkillId }`.
`fallbackEnvelopeFor` (item-spec) sets `minK/minT = spec.difficulty.kMin/tMin`
(never below), `allowedProblemStructures = ['direct_computation', 'single_step_word_problem']`.

`buildSafeSubstitute` (`safe-substitute.v1`) rebuilds ONE slot: same skill,
dropped to the envelope floor + a kernel-supported structure, `requiredSkillIds`
/ curriculum-safety facts carried over verbatim. **AI never lowers K/T.** A
kernel-backed substitute goes straight to the deterministic last-resort (one
attempt, guaranteed); a non-kernel substitute gets one model shot then FAILS.
Attempts/slot stay ≤ 6.

## 6. Product shape

CORE 5–8 verified required items + OPTIONAL 1–2 stretch/reasoning/challenge.
Delivered when: all REQUIRED_CORE `READY` **and** ≥1 delivered item.

## 7. Worksheet states

`READY | READY_WITH_SAFE_SUBSTITUTION | READY_WITH_OPTIONAL_OMISSIONS | FAILED`.
`READY_WITH_PENDING_CROSSCHECK` removed (migration `1758758400000`).
`worksheet_slots` + `criticality`, `substituted`, `omitted`, `degrade_reason`;
`worksheet_generation_runs` + `substituted_slots`, `omitted_slots`.

## 8. Product metrics (`worksheet-metrics.v1`)

`CORE_WORKSHEET_DELIVERY_RATE` (worksheets with 100% REQUIRED_CORE READY) ·
`VERIFIED_DELIVERY_RATE` (delivered items backed by a deterministic check or a
Group-C PASS) · `UNSAFE_DELIVERY_RATE` (delivered but unverified) ·
`OPTIONAL_CHALLENGE_AVAILABILITY` · `SAFE_SUBSTITUTION_RATE` ·
`OPTIONAL_OMISSION_RATE` · `REVIEW_QUEUE_RATE`.

**Targets:** `CORE_WORKSHEET_DELIVERY_RATE ≥ 99%` · `VERIFIED_DELIVERY_RATE = 100%`
· `UNSAFE_DELIVERY_RATE = 0%`.

## 9. D7 fixture

Kept the per-axis difficulty-envelope fix (frontier `kMax K5`, thinking `tMax T5`).
Always-on regression (`d7-confirmation-cohort.live.integration.test.ts`) asserts
each synthetic axis spec accommodates its own FRONTIER/THINKING targets + buckets,
and every pinned item lands inside the spec's K/T envelope.

## 10. Residual generation failures — deterministic mitigations

`normalizeNotation` (`compose.ts`): strips common LaTeX (`\frac`, `\times`,
`$...$`, `^\circ`) to SGK notation before validation. Genuine LaTeX still caught
by the `RAW_LATEX` content-quality gate — no safety weakening. Geometry-choice /
similarity handled by the existing failure-specific retry context; frontier
similarity pressure is now an OPTIONAL concern (omit, don't fail).

## 11. Tests

`worksheet-degraded.test.ts` — fault-injection: core failure + safe substitute;
core failure with no fallback → FAILED; optional failure → `READY_WITH_OPTIONAL_OMISSIONS`;
challenge failure → omitted + review; substitute stays inside envelope; every
delivered item verified; no review item reaches the child; min-item-count.
`worksheet-orchestrator.test.ts` §11 aggregate rewritten to the doc 68 §13 gates.

## 12–13. D7B — paid confirmation

`RUN_D7B=1` + `D7B_GEN_CAP_USD` (**0.75**) + `D7B_CROSSCHECK_CAP_USD` (**0.15**).
~30 synthetic worksheets, full real staging path (planner → durable queue →
worker → orchestrator v2 → MathKernel → routing → validator → retry → fallback →
last-resort → safe substitute → Group-C crosscheck → review queue → Postgres →
cost ledger). Hard gates: kernel correctness 100% · wrong accepted 0 · silent
contradiction 0 · Group-C false PASS 0 · `VERIFIED_DELIVERY_RATE = 100%` ·
`UNSAFE_DELIVERY_RATE = 0%` · `CORE_WORKSHEET_DELIVERY_RATE ≥ 99%` (30/30) ·
P0/P1 = 0.

### D7B RESULT

**Run 1 (2026-09-07, 30 worksheets, gen $0.5528/$0.75, xcheck $0.0477/$0.15) — commit `b62e5c9`**

| gate | result |
|---|---|
| VERIFIED_DELIVERY_RATE | **100.00%** (216/216) ✅ |
| UNSAFE_DELIVERY_RATE | **0.00%** ✅ |
| kernel deterministic correctness | **100.0%** (187/187) ✅ |
| wrong accepted / silent contradiction | **0 / 0** ✅ |
| max attempts / slot | **6** (≤ 6) ✅ |
| no duplicate worksheet | ✅ |
| **CORE_WORKSHEET_DELIVERY_RATE** | **83.3% (25/30)** ❌ — gate ≥ 99% |

worksheet_state: `READY` 16 · `READY_WITH_OPTIONAL_OMISSIONS` 8 · `READY_WITH_SAFE_SUBSTITUTION` 1 · `FAILED` 5.
Recovery: FIRST_PASS 55% · RETRY 11% · FALLBACK 9% · LAST_RESORT 2.5% · CROSSCHECK 12% ·
SAFE_SUBSTITUTION 0.4% · OMITTED 5.4% · FAILED 4.6%. Review-queue rate 10%.

**5 FAILED worksheets, two root causes (both fixed, commit `c3f7f89`):**

1. **g4_frac (2)** — a FRACTION_ARITH deterministic-last-resort framing
   `"Cho biểu thức A = …; rút gọn A"` had no word in `QUESTION_CUE_RE`, so it
   tripped `MALFORMED_VIETNAMESE:BLOCK` and last-resort could not finish a
   REQUIRED_CORE slot. Fix: `rút gọn / thực hiện / giải / xác định / …` added to
   the cue vocabulary.
2. **g7_geometry (3)** — `M7.GEO.PARALLEL_CRITERIA` `currentSkill` items were
   forced to answerKind `choice` (classification) by an over-greedy
   `CLASSIFICATION_NAME_RE` (`song song` / `dấu hiệu nhận biết`), had **no kernel**
   and **no last-resort backstop**, and failed on SIMILARITY / COMPOSE
   (choice-as-numeric) / crosscheck-UNCERTAIN. Fix: (a) new **`PARALLEL_ANGLES`
   Group-A MathKernel** (so-le-trong / đồng-vị = x; trong-cùng-phía = 180 − x —
   deterministic, oracle-verified); (b) `CLASSIFICATION_NAME_RE` narrowed so
   parallel-line work is numeric angle computation. 5 of 6 geometry slots now
   kernel-backed; the 6th safe-substitutes to a kernel-backed `PARALLEL_ANGLES`
   item.

All **safety** gates passed run 1 — nothing wrong was ever delivered; the 5
failures were REQUIRED_CORE slots correctly held back (`FAILED`, review row), not
served.

**Run 2 (targeted, g4_frac + g7_geometry + g7_frontier, 9 ws, gen $0.1391) — commit `c3f7f89`**

- **g4_frac: FIXED** — 0 failures, no `MALFORMED_VIETNAMESE`.
- **g7_frontier: FIXED** — a CURRENT slot hit `SIMILARITY_OR_DUPLICATE`, then
  **safe-substituted** to a kernel-backed item → `READY_WITH_SAFE_SUBSTITUTION`.
- **g7_geometry: still 3 FAILED** — but now the PARALLEL_ANGLES kernel IS
  assigned; the failure moved to *"deterministic last-resort could not finish the
  slot"*: the 4 reworded-but-same-skeleton framings collided on the similarity
  gate across a 4–5-slot geometry worksheet. Safety gates still all green
  (VERIFIED 100% (51/51), UNSAFE 0%, kernel 100% (45/45)).

**Fix (`35768b8`):** 10 structurally-varied PARALLEL_ANGLES framings (transversal
/ fence beam / railway tà vẹt / trapezoid diagonal / …). Offline: every slot of a
6-slot geometry worksheet completes via last-resort (v0, no collision).

**Run 3 (geometry spot check)** — NOT RUN; ~$0.058 left was below the per-worksheet
floor. **$0 spent.**

### D7B FINAL CLEAN CONFIRMATION (fresh 30-worksheet cohort, all fixes in place) — 2026-09-08, `run=rmtrh8b9n`, commit `4ffc17d`

Fresh cohort (`RUN_TAG` nonce in the spec id + child_ref — no replay of a prior
realization), all 8 axes, complete real staging path (planner → slot criticality
→ fallback envelope → durable queue → orchestrator v2 → MathKernel → locked
routing → validator → content-quality → retry → fallback → last-resort → safe
substitute → Group-C crosscheck → optional omission/review → assembly →
persistence → cost ledger → observability). Report:
`docs/implementation/data/68_d7b_final_cohort.txt`.

| hard gate | result |
|---|---|
| **CORE_WORKSHEET_DELIVERY_RATE** | **100.0% (30/30)** ✅ — no rounding |
| **VERIFIED_DELIVERY_RATE** | **100.00% (230/230)** ✅ |
| **UNSAFE_DELIVERY_RATE** | **0.00%** ✅ |
| kernel deterministic correctness | **100.0% (207/207)** ✅ |
| wrong accepted / silent semantic contradiction | **0 / 0** ✅ |
| Group-C false PASS | **0** ✅ |
| max attempts / slot | **5** (≤ 6) ✅ |
| no duplicate worksheet | ✅ |
| FAILED slots | **0** ✅ |
| spend | gen **$0.4894 / $0.70** · xcheck **$0.0256 / $0.15** ✅ |

worksheet_state: `READY` 19 · `READY_WITH_SAFE_SUBSTITUTION` 1 · `READY_WITH_OPTIONAL_OMISSIONS` 10 · `FAILED` 0.

Recovery (240 items): FIRST_PASS 59.2% · RETRY 13.3% · FALLBACK 8.3% ·
LAST_RESORT 5.0% · CROSSCHECK 9.6% · **SAFE_SUBSTITUTION 0.4%** · OMITTED 4.2% ·
**FAILED 0**. avg 1.53 attempts/item.

**Safe substitution — 1 slot** (`g7_linear_eq item-07`: K2/T3 `compare_and_decide`
→ K1/T1 `direct_computation`, **skill PRESERVED**, kernel-backed, was CROSSCHECK_FAIL).
`SAFE_SUBSTITUTION_RATE (core) = 0.5%` — well below the 10% review threshold;
completion is **not** hidden behind degradation.

**Optional omissions — 10/40 (25%)**, all `OPTIONAL_STRETCH` / `OPTIONAL_REASONING`,
each → review queue, none block delivery: `g4_reasoning item-07` (thinking, ×4 —
last-resort variety), `g7_frontier item-07` (`M7.ALG.SYMMETRIC` similarity /
curriculum, ×3), `g4_arith item-08`, `g7_ratio item-08` (content-quality),
`g7_geometry item-08` (reasoning COMPOSE). `OPTIONAL_CHALLENGE_AVAILABILITY 100%`
(every worksheet carries ≥1 optional). `REVIEW_QUEUE_RATE 4.2%`.

Cost/item **$0.00204**; cost/delivered-worksheet **$0.0163**. Latency: slot
p50/p95 6.8s / 22.4s; worksheet p50/p95 40s / 99s. Model share 56.4% gpt-4.1-mini
/ 43.6% gpt-5-mini.

## Verdict

- `FINAL_CONFIRMATION_COMPLETE = true`
- `INTERNAL_LIVE_READY = true`

**P0 = 0 · P1 = 0.** P2 (recorded, not fixed — per final directive §10): narrow
`M7.ALG.SYMMETRIC` frontier content and the geometry `explain_or_justify` optional
item drive most omissions; the g4_reasoning thinking-challenge item (`DISTRIBUTIVE`
`find_the_error`) has thin last-resort variety. All are OPTIONAL — omitted to
review, never served broken.

**LIVE stays OFF. Locked routing unchanged. No public exposure. No billing
change. No further paid cohorts.** Total additional paid spend this directive:
generation **$0.4894**, crosscheck **$0.0256**.

## 15. Internal LIVE

If D7B passes every hard gate → `FINAL_CONFIRMATION_COMPLETE=true`,
`INTERNAL_LIVE_READY=true`. **LIVE stays OFF.**

**`INTERNAL_LIVE_READY = true`** as of the D7B FINAL clean confirmation
(2026-09-08, 30/30 core delivery, every hard gate green, $0.4894/$0.70).
**LIVE is NOT enabled** — that flip is a separate, explicit decision.
