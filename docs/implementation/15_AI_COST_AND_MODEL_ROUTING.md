# 15 — AI Cost & Model Routing (v1.1)

> **Authority:** `File du an/AI_Parent_Learning_Copilot_Pricing_AI_Cost_Routing_v1.1.zip`
> — `Pricing_AI_Cost_Guardrails_Model_Routing_v1.1.md` + the three `*_v1.1.yaml`.
> **Supersedes** `PRICING_AND_COST_GUARDRAILS.md` (v1.0). Part of the
> AI-Generation-First migration ([12](12_ARCHITECTURE_MIGRATION_AUDIT.md)).

Related: [13](13_CURRICULUM_CLOCK_AND_CONTEXT_RESOLVER.md) · [14](14_AI_EXERCISE_GENERATION_ARCHITECTURE.md) · [PRIVACY_ARCHITECTURE.md](PRIVACY_ARCHITECTURE.md).

---

## 1. Commercial model (LOCKED — v1.1 §5)

Pricing unchanged: **FREE 0 · BASIC 169K · PLUS 229K · PRO 329K** VND/month.

`Modeled Profit = Price × 75% − 30,000đ − AI COGS`
(30K = 10K server/data + 20K HR/marketing; the 75% absorbs 15% store/payment + 10% tax reserve.)
`Max AI COGS at the 50% modeled-margin floor = Price × 25% − 30,000đ`.

| Plan | Price | AI **target** | AI **operational ceiling** | **Absolute** AI boundary (50% floor) |
|---|---:|---:|---:|---:|
| FREE | 0 | 2,000 | 3,000 | (acquisition budget) |
| BASIC | 169,000 | 8,000 | 10,000 | 12,250 |
| PLUS ⭐ | 229,000 | 15,000 | 22,000 | 27,250 |
| PRO | 329,000 | 28,000 | 40,000 | 52,250 |

Modeled margin: at target **BASIC 52.5% · PLUS 55.3% · PRO 57.4%**; at
operational ceiling **BASIC 51.3% · PLUS 52.3% · PRO 53.7%**. Operational ceilings
sit deliberately below the absolute boundary.

> These are **contribution-style planning** margins, not final accounting profit.
> Pilot must fold in real CAC, payroll, refunds, support, store mix, tax, Free subsidy.

**Pricing stays 169K/229K/329K unless measured pilot economics show the 50% floor
cannot be held.**

---

## 2. Three thresholds, four guardrail states (`AIBudgetGuardrail`)

v1.0 had 2 thresholds + a 3-colour light. v1.1 has **3 thresholds** and **4 states**:

| State | Condition | Action — quality is NEVER the lever first |
|---|---|---|
| **GREEN** | projected monthly AI COGS ≤ target | normal operation |
| **YELLOW** | target < projected ≤ operational ceiling | inspect usage; improve caching/batching; cut unnecessary verifier calls; improve routing; detect retry bugs. **Do not degrade core learning.** |
| **RED** | projected > operational ceiling | identify abuse/anomaly; **block pathological retry loops**; restrict non-essential expensive ops; force *standard* tasks to the default route; **preserve educationally-necessary advanced escalation** |
| **BLOCKER** | projected paid-plan economics crosses the absolute 50% boundary | requires **product/finance approval** before rollout |

Order of investigation on YELLOW/RED (v1.1 §M): retry loop → caching → batching →
unnecessary verifier → abnormal usage → model routing → abuse. Only after those.

---

## 3. Model routing (`AIModelRouter`)

### 3.1 Roster

| Role | Model | Notes |
|---|---|---|
| **Default production** | `gpt-5.6-luna` | vision/extraction, classification, skill/PT candidate mapping, **standard + worksheet-batch generation**, basic diagnosis, parent summaries, Teach Me, plan explanation, standard Next-Best-Question |
| **Advanced candidate** | **OPEN** — benchmark `gpt-5.6-terra` vs `claude-sonnet-5` | pick the **cheapest advanced pipeline that passes quality gates** for the workload; may differ per capability |
| **Quality / golden eval** | `gpt-5.6-sol` | offline only — Golden QA, generator audit, benchmark adjudication, regression. **Never routine production.** |
| **OCR** | Luna Vision baseline; separate OCR (Google Document AI or other) = adapter/**fallback** | locked only if the real-image benchmark proves material quality/cost benefit |

### 3.2 Non-negotiables (`ai_model_routing_v1.1.yaml`)

1. **Plan tier does NOT select the model.** PRO doing standard K2/T2 → default
   model. BASIC hitting a legitimate T5/HSG case → may escalate (if policy allows).
   Plan sets only the **budget envelope**, never the route.
2. AI cannot invent a production `skill_id`.
3. Low-confidence extraction/mapping cannot silently update the Learning Twin.
4. Advanced provider not locked until benchmark.
5. Live model prices/versions are **config with `effective_date`**, never hard-coded
   in business logic.

### 3.3 Advanced-candidate gate

Route an operation to the advanced tier when **any**: `K ≥ K4` · `T ≥ T4` ·
HSG/Olympiad · difficult proof · nonlinear algebra · complex root-gap diagnosis ·
Luna verifier failure · default-model confidence below the routing threshold.

Until the advanced model is chosen (post-benchmark, v1.1 §15), an advanced-tier
operation runs on **Luna at high effort** and is flagged `escalated_from` +
`escalation_reason` for offline QA (carried over from the v1.0 Q2 decision).

---

## 4. Operation taxonomy (v1.1 §4)

Cost and volume are tracked **per operation**, not per user:

`WORKSHEET_BATCH_GENERATION` · `NEXT_BEST_QUESTION` · `VISION_EXTRACTION` ·
`ERROR_DIAGNOSIS` · `PARENT_COPILOT` · `TEACH_ME` · `WEEKLY_SUMMARY` ·
`EXAM_REVISION` · `ADVANCED_VERIFICATION` · `SKILL_MAP` · `CONTENT_CLASSIFY` ·
`GOLDEN_EVAL` (offline).

---

## 5. Cost telemetry (`AICostLedger`) — v1.1 §10

Every AI/OCR call logs at least:

```
provider · model · model_version · price_config_effective_date
operation_type
user_id · child_id_pseudonymous · plan
input_tokens · cached_input_tokens · output_tokens · image_count · ocr_pages
estimated_cost_usd · estimated_cost_vnd
latency_ms · confidence · retry_count
escalated_from · escalation_reason
generation_spec_id · learning_context_source · K_target · T_target
```

No child name or unnecessary PII in telemetry (Privacy Architecture §N).

New vs the v1.0 `AiUsageEvent`: `model_version`, `price_config_effective_date`,
`generation_spec_id`, `learning_context_source`, `K_target`, `T_target`,
`escalated_from`.

---

## 6. Cost forecasting (v1.1 §12) — NOT tokens/user

```
Monthly AI COGS = Σ over operations ( volume × measured unit cost × retry/escalation factor )
```

Dimensions: plan · grade · K/T · standard vs advanced · scan type · active days ·
worksheet batches · Next-Best-Questions · Parent Copilot sessions · exam periods ·
advanced escalation rate. Recompute after the AI/OCR benchmark and again during pilot.

---

## 7. Cost optimization ladder (v1.1 §9 — order matters)

1. Send only relevant curriculum/skill/prereq/Twin graph nodes as context.
2. Cache stable system rules + schemas (prompt/schema caching).
3. Batch-generate the daily worksheet (1 call, not N).
4. Deterministic validation first.
5. AI verifier only when risk/difficulty requires.
6. Luna-first.
7. OCR fallback only where measured useful.
8. Advanced escalation only where educationally required.

**Never** solve cost by reverting to a static Question-Bank-first architecture.

---

## 8. FREE plan policy (v1.1 §6, `ai_budget_guardrails_v1.1.yaml`)

Real value, not a fake trial: planning assumption ~**10 days/month** of
AI-generated personalized practice, ~**2 scan pages/month**, basic
context/twin/gap, a few AI magic moments. Under budget pressure → **reuse
previously-generated personalized sets + deterministic transforms + cache +
defer** non-essential calls. **Never present a cached set as a fresh AI diagnosis.**

---

## 9. Benchmark integration (v1.1 §13)

Reuse the AI/OCR Benchmark Kit (`packages/testing/benchmark-data/`). Benchmark
must answer: Luna sufficient for default vision? · separate OCR materially better
for VN handwriting/math? · Terra vs Sonnet for advanced/HSG · confidence
thresholds · real VND/page & VND/operation · **projected AI COGS by plan under
AI-generation-first usage**. No advanced provider locked before results.
(Real anonymized images still pending — D-07, deferred to post-pilot.)

---

## 10. Codebase map (target)

| Concern | Module / table |
|---|---|
| Plan economics | `@copilot/ai` `margin.ts` (`PLAN_COMMERCIALS` v1.1: target/ceiling/absolute) |
| Budget guardrail | `@copilot/ai` `budget.ts` → `AIBudgetGuardrail` (GREEN/YELLOW/RED/BLOCKER) |
| Model routing | `@copilot/ai` `routing.ts` → `AIModelRouter` (plan ≠ model) |
| Prices (effective-dated) | `@copilot/ai` `pricing.ts` · `ai_pricing_registry` |
| Cost ledger | `@copilot/ai` `usage-event.ts` → `AICostLedger` · `ai_usage_events` (+ new columns) |
| Operation forecast | `ai_operation_cost_rollup` (new) |
| Benchmark | `@copilot/testing` `src/benchmark/*` + `benchmark-data/` |
| Migrations | `1756771200000` (v1.0) + a new one adding columns + rollup table |
