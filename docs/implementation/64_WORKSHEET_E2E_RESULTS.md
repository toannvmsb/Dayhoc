# 64 — PAID WORKSHEET E2E RESULTS (doc 63 §K)

> 2026-09-06. 6 representative specs × real `orchestrateWorksheet` ×
> gpt-4.1-mini default + gpt-5-mini high-complexity/fallback × maxRetriesPerModel 1
> × last-resort ON × NO gpt-4o(-mini). **TOTAL SPEND $0.0719** of a $0.50 hard cap
> (per-worksheet ceiling $0.09). Immutable raw sidecar
> `docs/implementation/data/64_ws_e2e_raw.jsonl` (52 rows, no child PII —
> benchmark specs use synthetic ids). Report:
> `docs/implementation/data/64_ws_e2e_report.txt`.

Specs: `BENCH-LT-G4-01` (4), `BENCH-LT-G4-06` (8), `HC04` (10, 4 frontier + 3
reasoning), `BENCH-LT-G7-03` (12), `BENCH-LT-G7-06` (8), `HC06` (10, 4 frontier +
3 reasoning) — **52 items, 46 kernel-supported, 6 reasoning (Group C)**.

---

## The 17 metrics

| # | metric | value |
|---|---|---|
| 1 | **full worksheet completion** | **100.0% (6/6)** |
| 2 | **valid-item completion** | **100.0% (52/52)** |
| 3 | **kernel deterministic correctness** | **100.0% (46/46 kernel-READY)** · kernel wrong = 0 |
| 4 | production-ready deterministic | 88.5% (46/52) — the balance is Group C |
| 5 | PENDING_CROSSCHECK | 11.5% (6/52) — all 6 genuine reasoning items |
| 6 | gpt-4.1-mini call share | 72.4% (42 calls) |
| 7 | gpt-5-mini call share | 27.6% (16 calls) |
| 8 | retry rate | 0.10 / item (5 retries total) |
| 9 | last-resort usage | **0** (models handled everything within retry + escalation) |
| 10 | unresolved / FAILED slots | **0** |
| 11 | cost / item | $0.00138 (~**36 VND**) |
| 12 | cost / completed worksheet | $0.0120 (~**312 VND**) |
| 13 | slot latency p50 / p95 | 3 212 / 11 125 ms |
| 14 | worksheet latency p50 / p95 | 17 865 / 38 832 ms |
| 15 | validator false positives | **NONE** — see manual review below |
| 16 | silent semantic contradiction | **NONE** |
| 17 | cost-ceiling events | **0** |

Max attempts on any slot: **3**. Escalation to gpt-5-mini fired once
(`BENCH-LT-G4-01`, 1 fallback call) and recovered.

### Per worksheet

| spec | state | ready | pending | failed | cost | calls | retries | fallback | last-resort | latency |
|---|---|---|---|---|---|---|---|---|---|---|
| HC04 | READY_WITH_PENDING_CROSSCHECK | 7 | 3 | 0 | $0.0151 | 10 | 0 | 0 | 0 | 27.7 s |
| HC06 | READY_WITH_PENDING_CROSSCHECK | 7 | 3 | 0 | $0.0193 | 11 | 1 | 0 | 0 | 38.8 s |
| BENCH-LT-G4-01 | READY | 4 | 0 | 0 | $0.0068 | 6 | 1 | 1 | 0 | 13.8 s |
| BENCH-LT-G4-06 | READY | 8 | 0 | 0 | $0.0106 | 10 | 2 | 0 | 0 | 11.9 s |
| BENCH-LT-G7-03 | READY | 12 | 0 | 0 | $0.0128 | 13 | 1 | 0 | 0 | 17.9 s |
| BENCH-LT-G7-06 | READY | 8 | 0 | 0 | $0.0075 | 8 | 0 | 0 | 0 | 12.4 s |

---

## §15 — manual validator-false-positive review

Every previously-FP-prone pattern appeared live and **passed cleanly**:

| item | pattern | previously | now |
|---|---|---|---|
| `HC04::item-06` — *"Cho phương trình 8x + (-14) = 266. Tìm x."* → x = 35 | LINEAR_EQ signed constant (doc 59 P1) | FALSE POSITIVE | **PASS** ✓ |
| `HC06::item-06` — *"Tìm x biết 6x + 16 = 76."* → x = 10 | LINEAR_EQ | — | PASS ✓ |
| `BENCH-LT-G4-01::item-02` — *"…13 hàng; mỗi hàng 30 + 36 … 13 × (30 + 36) = 858"* | DISTRIBUTIVE operand-grab (doc 59 P0) | FALSE POSITIVE | **PASS** ✓ |
| `BENCH-LT-G7-06::item-08` — *"72 + 100 = 172, × 8 = 1376. Vậy kết quả là 1376"* | WORD_2STEP mid-solution number | FALSE POSITIVE | **PASS** ✓ |
| `BENCH-LT-G7-03::item-09` — UNIT_RATE word problem "2 máy → 26; 9 máy → 117" | UNIT_RATE realization | — | PASS ✓ |

**No valid item was wrongly rejected.** The reconciliation layer (doc 62) holds
against live model output.

### §16 — silent semantic contradiction: NONE

Every kernel item's stated answer was hand-verified against the intended
operation. Zero `SEMANTIC_UNKNOWN` accepted; zero `DETERMINISTIC_WRONG` accepted.

---

## Content-quality observations (NOT §K failures — for §L)

The gates verify *mathematical* correctness, not *pedagogical* polish. Two
items passed that a teacher would lightly revise:

1. **`BENCH-LT-G4-01::item-01`** — prompt contains LaTeX: `Tính giá trị của biểu
   thức \( \frac{2}{4} \times \frac{5}{8} \)`. Math is right (5/16); the notation
   is not SGK plain-text. The Vietnamese / SCHEMA check does not currently reject
   LaTeX markup. **1 / 52.**
2. **`BENCH-LT-G7-06::item-08` / `item-06`** — contrived WORD_2STEP scenarios
   ("xếp vào 8 hàng bằng nhau" then *multiply* by 8; "nhân đôi để tính hai
   ngày"). Consistent with the kernel's operation graph, but the scenario reads
   unnaturally. WORD_2STEP is not in the strict-operation semantic check.

These are **generation-prompt / gate-tuning** items, not recovery-orchestrator
defects.

---

## Hard acceptance conditions (doc 63 §K)

| condition | result |
|---|---|
| kernel deterministic correctness = 100% | ✅ 46/46 |
| no known semantic contradiction accepted | ✅ |
| no silent `SEMANTIC_UNKNOWN` acceptance | ✅ 0 |
| no unbounded retries | ✅ max 3 attempts / slot |
| no cost-ceiling bypass | ✅ 0 events, $0.072 ≤ $0.50 |

All five met. The E2E **confirms the simulated direction** (doc 62 routing sim:
~99% valid-item; doc 63 §J fault-injection: 100% with last-resort). Live numbers
landed at the optimistic end because the 6 specs happened to need almost no
recovery (5 retries, 1 escalation, 0 last-resort in 52 items) — a larger / harder
sample would exercise the tail more, but the machinery is proven end to end with
real models.

---

## `PRODUCTION_RECOVERY_READY = true`

for the **core generation + validation + recovery pipeline**. Remaining blockers
to **staging integration** (nothing here needs another model benchmark):

1. **Wire `orchestrateWorksheet` into `services/api`** behind an OFF feature flag
   (`AI_GENERATION_MODE` already has OFF/SHADOW/LIVE). The API still calls the C5
   shadow path. Needs: role-gated endpoint, spec built from the real planner,
   generators constructed from `loadAiGenerationConfig()`, trace persisted to
   `generated_exercise_sets` + `ai_usage_events`.
2. **Persistence + cost telemetry**: map `WorksheetTrace.totals` →
   `AICostLedger` / `ai_usage_events` (the new fields already exist), and
   per-slot outcomes → an append-only `worksheet_slots` record. Migration needed.
3. **Group C crosscheck** (~11% of items land PENDING_CROSSCHECK): the
   `AnswerCrosscheckAdapter` is a stub. A worksheet with reasoning items ships as
   `READY_WITH_PENDING_CROSSCHECK` — the parent-facing UI must show that state
   honestly, and a human/AI crosscheck queue must exist before those items are
   presented as verified. Approval-gated, separate phase.
4. **Human-review queue** for a genuinely `FAILED` worksheet (Group B kernel or
   no-kernel item that neither model nor the Group-A last-resort can complete).
   Not hit in this E2E but must exist before production.
5. **Content-quality gate** for LaTeX / unnatural scenarios (§ observations
   above) — a small deterministic check (reject `\frac`, `\(`, `$...$` in a
   prompt; flag WORD_2STEP scenarios whose surface verb contradicts the operation).
6. **Larger confirmation run** (optional, approval-gated): the 6-spec E2E needed
   almost no recovery. One ~20-worksheet paid run (hard cap ~$0.50) would
   pressure-test the escalation + last-resort paths with real models before the
   staging cutover — but is **not** a blocker for building the integration.
7. **Live-model routing calibration**: gpt-5-mini took 27.6% of calls here on
   specs chosen to be frontier-heavy; on a typical Grade-4 worksheet it would be
   near 0. Monitor the real split once wired and adjust `HIGH_COMPLEXITY_STRUCTURES`
   if gpt-5-mini share drifts high.

---

## STOP

Not done: LIVE production · `services/api` wiring · paid Group-C crosscheck ·
larger benchmark · routing change · gpt-4o-mini. Returned the §K report +
`PRODUCTION_RECOVERY_READY = true` + the staging-integration blocker list.
