# Pricing + AI Cost Guardrails + Model Routing

> **Authority:** `File du an/Pricing_AI_Cost_Guardrails_Model_Routing_v1.0.md` (anh, 2026-08-31)
> + `File du an/AI_Parent_Learning_Copilot_AI_OCR_Benchmark_Kit_v1.0.zip`.
> This is the binding engineering spec for pricing, AI cost telemetry, the
> budget engine and model routing. It does **not** change the LOCKED educational
> MVP. Public package prices do not change without explicit approval.

Related: [PRIVACY_ARCHITECTURE.md](PRIVACY_ARCHITECTURE.md) (provider compliance,
data minimization), [06_AI_ORCHESTRATION_PLAN.md](06_AI_ORCHESTRATION_PLAN.md).

---

## 1. Decision status

### LOCK NOW — implemented in code
| Item | Where |
|---|---|
| Public working prices Free / 169K / 229K / 329K | `@copilot/ai` `PLAN_COMMERCIALS` (`margin.ts`) |
| 50% modeled contribution-margin floor (even at AI hard ceiling) | `contributionMargin`, `margin.test.ts` reproduces §6 tables |
| AI budget targets + hard ceilings per plan | `PLAN_COMMERCIALS`, `checkBudget` (`budget.ts`) |
| Luna-first architecture | `ROUTING_MATRIX`, `resolveRoute` (`routing.ts`) |
| Provider adapter (capability + compliance) | `AIProviderAdapter` (`provider.ts`) |
| Cost telemetry (`ai_usage_event`) | `AiUsageEvent`, `buildUsageEvent`, `rollup` (`usage-event.ts`) |
| Budget enforcement + graceful fallback | `checkBudget`, `FALLBACK_ORDER`, `simulateEscalationLoop` |
| Pricing registry with effective dates | `PricingRegistry` (`pricing.ts`), table `ai_pricing_registry` |
| OCR is optional / fallback / benchmark-driven | routing tier `ocr_assist`, benchmark kit |

### BENCHMARK BEFORE LOCKING — harness built, decision pending
| Item | Status |
|---|---|
| Advanced production model: **Claude Sonnet 5 vs GPT-5.6 Terra** | `resolveRoute(...).advancedModelPending === true` until chosen; `FINAL_ROUTING_DECISION_TEMPLATE.json` = `NOT_RUN` |
| Google OCR fallback thresholds | benchmark categories `ocr_fallback_categories` (empty) |
| Exact confidence thresholds | `RouteContext.escalateBelowConfidence` is caller-supplied config |
| Per-operation token / image budgets | to be set from measured telemetry |

**Blocker for the benchmark:** it needs **30–50 real, PII-anonymized** Grade 4 +
Grade 7 notebook/test images + human-verified ground truth. The kit ships 40
slots (`packages/testing/benchmark-data/`), all `IMAGE_REQUIRED`. See
[PENDING_APPROVAL.md](PENDING_APPROVAL.md) P-04.

### VALIDATE AFTER PILOT
Actual AI COGS by cohort, Free→Paid conversion, scan frequency, advanced-model
escalation rate, paid-plan mix, willingness to pay.

---

## 2. Commercial model (§1, §6)

| Plan | Price/mo | AI target | AI hard ceiling | Scan pages/mo | Worksheets/mo |
|---|---:|---:|---:|---:|---:|
| FREE | 0đ | 1,500đ | 2,000đ | 2 | 0 |
| BASIC | 169,000đ | 6,000đ | 8,000đ | 8 | 8 |
| PLUS ⭐ | 229,000đ | 14,000đ | 18,000đ | 28 | 28 |
| PRO | 329,000đ | 28,000đ | 35,000đ | 60 | 60 |

**Contribution = 0.75 × Price − 30,000đ − AI_COGS** &nbsp;·&nbsp; floor = 50% of revenue.
`minimumPriceForFloor(aiCogs) = 4 × (30,000 + aiCogs)`.

Modeled margin (from `marginTable()`, verified in `margin.test.ts`):

| Plan | @ AI target | @ AI ceiling |
|---|---:|---:|
| BASIC | 53.7% | 52.5% |
| PLUS | 55.8% | 54.0% |
| PRO | 57.4% | 55.2% |

Traffic light: GREEN > 55% · YELLOW 50–55% · RED < 50% → cost/routing intervention.

Do **not** lower a price because measured AI COGS came in low — bank the margin (§6).

---

## 3. Model routing (§3, §4)

Prices for planning only (`PricingRegistry`, FX 26,000đ/USD configurable):

| Model / service | Input | Output |
|---|---:|---:|
| GPT-5.6 Luna | $0.20/M | $1.20/M |
| GPT-5.6 Terra | $2.00/M | $12.00/M |
| GPT-5.6 Sol (offline QA) | $4.00/M | $20.00/M |
| Claude Sonnet 5 | $2.00/M | $10.00/M |
| Google Document AI OCR | first 1,000 pages free, then ~$1.50/1,000 | — |

**Target: 85–95% of production AI calls stay on Luna or deterministic / verified
question-bank paths** (`cheapPathShare`, `LUNA_OR_CHEAPER_TARGET_*`).

`ROUTING_MATRIX` (data, `routing.ts`) — primary tier + escalation trigger per operation:

| Operation | Primary | Escalates when → tier |
|---|---|---|
| `document_classify` | deterministic | low confidence → luna |
| `vision_extract` | luna | handwriting / math layout / low confidence → ocr_assist |
| `skill_map`, `problem_type_map` | luna + graph validator | ambiguous → advanced |
| `diagnose` | deterministic | conflicting evidence / complex root → advanced |
| `generate_standard` | question_bank | personalization missing → luna |
| `generate_advanced` | question_bank | K4/K5 or T4/T5 → advanced |
| `explain`, `parent_summary`, `plan_wording` | luna | complex synthesis / planner conflict → advanced |
| `verify` | advanced | verifier disagreement → offline_qa |
| `golden_eval` | offline_qa | (never escalates live) |

**LLM never owns** (`LLM_NEVER_OWNS`): production Skill IDs, prerequisite DAG,
permissions, consent, gap-lifecycle thresholds, mastery formula, time-budget
constraints, billing/quota enforcement.

The advanced tier resolves to `advancedModelPending` until the benchmark picks
Sonnet 5 or Terra; routing may pick different winners per capability (§3.2).

---

## 4. Budget enforcement (§5, §8, §10.9)

`checkBudget({ plan, state, estimatedCostVnd, requestedTier, safetyCritical? })`:

- **deterministic / question_bank / cache** — never consult the budget.
- **under target** — metered call allowed.
- **over target, under ceiling** — cheap tiers allowed; the `advanced` tier is
  downgraded to `luna`.
- **would cross the hard ceiling** — refused; degrade one tier (`cheaperThan`).
- **`safetyCritical`** (privacy, deletion, correctness validation) — always
  bypasses the budget. Never traded away for cost (§8).

Graceful fallback order (`FALLBACK_ORDER`): deterministic → question_bank →
cache → luna → ocr_assist → advanced.

**Guardrail (§10.9):** `simulateEscalationLoop` proves a retry/escalation loop
can never push metered spend past the ceiling — the ceiling check runs before
every call and re-checks on escalation. Enforced in `budget.test.ts` for all 4 plans.

---

## 5. Cost telemetry (§7)

Every AI/OCR call → one `AiUsageEvent` (`usage-event.ts`) → table
`ai_usage_events` (INSERT-only, trigger-enforced). Refs are pseudonymous — never
a raw user/child id.

`rollup()` produces the §7 dashboard metrics: AI COGS/MAU, cheap-path share,
advanced-model share, escalation rate, OCR fallback rate, schema-valid rate.
`cogsPerUser(events, plan, activeUsers)` feeds the traffic light.

---

## 6. Benchmark harness (`packages/testing/benchmark-data/` + `src/benchmark/`)

- `benchmark_cases.jsonl` — 40 image slots (Grade 4 printed/handwriting/fraction/
  geometry, Grade 7 rational/equation/geometry/advanced, low-quality). All
  `IMAGE_REQUIRED`.
- `pipelineOutputSchema` — the one structured-output contract all 4 pipelines
  (P1 Luna · P2 Luna+Google OCR · P3 Terra · P4 Sonnet) must satisfy.
- `weightedScore` + `checkHardGates` — scoring_and_gates.yaml as code (weights
  sum to 100; 5 hard gates incl. "no invented production skill_id", "no silent
  commit below confidence threshold").
- `selectDefaultPipeline` — Phase D rule: **cheapest** pipeline that clears all
  gates and ≥ 95/100 weighted on standard cases; `null` while none qualifies.
- `benchmark.test.ts` — validates the harness + scoring math + the cost→margin
  guardrail. **Does not rank providers** (needs real images).

Deliverables after a real run: `BENCHMARK_REPORT.md`, `COST_REPORT.md`,
`ROUTING_RECOMMENDATION.md`, filled `FINAL_ROUTING_DECISION_TEMPLATE.json`.
Stop after the report — do not change production routing/price/package until approved.

---

## 7. Codebase map

| Concern | Module / table |
|---|---|
| Plan vocabulary | `@copilot/domain` `subscription.ts` (`Plan`, `PLANS`) |
| Prices (effective-dated) | `@copilot/ai` `pricing.ts` · `ai_pricing_registry` |
| Routing matrix + resolver | `@copilot/ai` `routing.ts` |
| Margin model | `@copilot/ai` `margin.ts` |
| Budget engine + ledger port | `@copilot/ai` `budget.ts` · `plan_budget_ledger` |
| Usage telemetry | `@copilot/ai` `usage-event.ts` · `ai_usage_events` |
| Provider adapter contract | `@copilot/ai` `provider.ts` (`AIProviderAdapter`) |
| Benchmark harness | `@copilot/testing` `src/benchmark/*` + `benchmark-data/` |
| Migration | `migrations/1756771200000_ai_cost_telemetry.js` |
