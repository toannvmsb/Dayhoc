# AI Parent Learning Copilot — Pricing + AI Cost Guardrails + Model Routing v1.0

**Status:** Dev constraint / commercial working model  
**Date:** 2026-08-31  
**Purpose:** Input trực tiếp cho Claude để cập nhật architecture, AI provider adapter, cost telemetry, quota engine và pricing logic.

---

## 1. Executive decision

### Production model strategy
- **Default high-volume model:** `gpt-5.6-luna` — text + image/vision + structured output.
- **Advanced reasoning model:** **benchmark-gated** giữa `claude-sonnet-5` và `gpt-5.6-terra`; không hard-code nhà cung cấp trước benchmark. Về giá hiện tại Sonnet 5 có lợi thế nhẹ ở output ($10/M vs Terra $12/M), trong khi input cùng $2/M.
- **Offline quality judge / Golden QA:** `gpt-5.6-sol`, không dùng trong normal production traffic.
- **OCR fallback:** Google Document AI Enterprise OCR, chỉ dùng khi benchmark chứng minh cải thiện extraction/handwriting/layout hoặc khi Luna Vision confidence thấp. Không coi OCR text thuần là nguồn sự thật cho ký hiệu/toán học.
- **PDF/worksheet:** AI sinh structured JSON; deterministic renderer tạo PDF. Không dùng image generation.

### Commercial pricing recommended
| Plan | Price/month | AI target COGS | AI hard ceiling | Role |
|---|---:|---:|---:|---|
| FREE | 0đ | <=1,500đ | 2,000đ | acquisition + magic moment |
| BASIC | **169,000đ** | <=6,000đ | 8,000đ | biết con yếu gì / daily guidance |
| PLUS ⭐ | **229,000đ** | <=14,000đ | 18,000đ | full Learning Twin + Parent Copilot |
| PRO | **329,000đ** | <=28,000đ | 35,000đ | advanced/HSG/cross-grade/deep diagnosis |

**Hard business rule:** modeled net contribution margin must remain **>=50% revenue** after AI + 15% store/payment + 10,000đ server/data + 20,000đ HR/marketing allocation + 10% revenue tax assumption.

---

## 2. Current public model prices used for planning

Planning FX for internal estimates: **26,000 VND/USD** (configurable; do not hard-code in billing).

| Model/service | Input | Output | Notes |
|---|---:|---:|---|
| GPT-5.6 Luna | $0.20/M tokens | $1.20/M tokens | default, cost-sensitive, image input |
| GPT-5.6 Terra | $2.00/M | $12.00/M | advanced candidate |
| GPT-5.6 Sol | $4.00/M | $20.00/M | offline QA / hardest cases |
| Claude Sonnet 5 | $2.00/M | $10.00/M | advanced candidate; benchmark vs Terra |
| Google Document AI Enterprise OCR | first 1,000 pages free; then ~$1.50/1,000 pages | n/a | ~39đ/page at 26k FX after free tier |

**Important:** prices are external configuration, not constants in educational logic. Add a pricing registry with effective date.

---

## 3. Why this routing is preferred

### 3.1 Luna should handle most traffic
Luna is dramatically cheaper than Sonnet/Terra and supports image input. Use it for:
- scan/vision extraction;
- classify document/page;
- candidate skill mapping;
- problem-type mapping;
- basic error classification;
- parent summaries;
- Daily Plan explanation;
- Teach Me in 3 Minutes;
- standard exercise generation when Verified Question Bank cannot satisfy personalization.

Target: **85–95% of production AI calls** should stay on Luna or deterministic/question-bank paths.

### 3.2 Sonnet 5 vs Terra should be benchmarked, not decided by preference
Claude previously proposed Sonnet. Financially Sonnet 5 is currently slightly cheaper than Terra for output and equal for input. Therefore:
- build both behind `ProviderAdapter`;
- benchmark on real project cases;
- choose winner per capability, not one global winner;
- routing table may choose Sonnet for one capability and Terra for another.

Benchmark set must include at least:
- 30–50 real notebook/test images;
- Vietnamese handwriting;
- fractions, powers, radicals, equations, geometry notation;
- Grade 4 word problems;
- Grade 7 ratios/algebra;
- advanced/HSG T4–T5;
- root-gap diagnosis;
- answer/solution verification.

Score on: extraction accuracy, math-symbol accuracy, skill mapping, diagnosis accuracy, hallucination rate, latency, VND/case.

### 3.3 OCR should be fallback/assistive, not the educational brain
Google OCR is cheap enough that cost is not the blocker. The issue is quality/architecture. Use it when:
- handwriting/layout extraction improves measurably;
- Luna Vision confidence < threshold;
- need independent extraction for verification;
- document is text-heavy and OCR path is cheaper/reliable.

Possible pipeline:
`Image → Luna Vision → confidence gate → [optional Google OCR + advanced model] → schema validation → deterministic mapping/engine`

---

## 4. Model Routing Matrix

| Operation | Default | Escalate when | Escalation candidate |
|---|---|---|---|
| Document classification | deterministic/Luna | low confidence | Luna high effort |
| Homework/test/notebook extraction | Luna Vision | handwriting/math/layout low confidence | Google OCR assist + Sonnet5/Terra |
| Skill/problem-type mapping | Luna + graph validator | ambiguous candidates | Sonnet5/Terra |
| Basic error diagnosis | deterministic + Luna | conflicting evidence/root cause complex | Sonnet5/Terra |
| Parent summary | Luna | rare complex synthesis | Sonnet5/Terra |
| Daily Plan | deterministic planner + Luna wording | planner conflict | advanced model only for explanation |
| Standard questions | Verified Question Bank first | personalization missing | Luna |
| Advanced questions | bank first + Luna | K4/K5 or T4/T5 | Sonnet5/Terra |
| HSG/Olympiad | verified bank + advanced model | verifier disagreement | second advanced model / offline QA |
| Golden evaluation | offline | hardest adjudication | Sol |

**Never let LLM own:** production Skill IDs, prerequisite DAG, permissions, consent, gap lifecycle thresholds, mastery formula, time-budget constraints, billing/quota enforcement.

---

## 5. AI Cost Guardrails by plan

### FREE — 0đ
- Target <=1,500đ; hard stop/soft fallback at 2,000đ/user/month.
- 2 scan pages/month.
- Daily practice from Verified Question Bank + deterministic engine.
- AI only for magic moments: first scan, limited analysis, one sample Parent Copilot experience.
- When budget exhausted: cached/deterministic content continues; new expensive AI work waits for quota reset or upgrade.

### BASIC — 169K
- AI target <=6K; hard ceiling 8K.
- 2 A4/week, max 8/month.
- Luna-first.
- Learning Context + Twin Lite + Gap Lite + Daily Plan.
- No routine advanced-model Parent Copilot.

### PLUS — 229K ⭐
- AI target <=14K; hard ceiling 18K.
- 7 A4/week, max 28/month.
- Full Learning Twin + Gap Diagnosis + Parent Teaching Copilot + Exam Intelligence.
- Advanced-model escalation allowed under confidence/difficulty gates.

### PRO — 329K
- AI target <=28K; hard ceiling 35K.
- 15 A4/week, max 60/month.
- Advanced/HSG/Olympiad, cross-grade, deep diagnosis.
- Higher advanced-model allowance, but no unlimited model usage.

---

## 6. Margin validation

Assumptions requested for stress model:
- Store/payment: 15% revenue
- Tax planning assumption: 10% revenue
- Server/data allocation: 10K/user/month
- HR + marketing allocation: 20K/user/month
- AI: target or hard-ceiling by plan

Formula:
`Contribution = 0.75 × Price - 30K - AI_COGS`

### At target AI COGS
| Plan | Price | AI target | Contribution | Margin |
|---|---:|---:|---:|---:|
| Basic | 169K | 6K | 90.75K | **53.7%** |
| Plus | 229K | 14K | 127.75K | **55.8%** |
| Pro | 329K | 28K | 188.75K | **57.4%** |

### At AI hard ceiling
| Plan | Price | AI ceiling | Contribution | Margin |
|---|---:|---:|---:|---:|
| Basic | 169K | 8K | 88.75K | **52.5%** |
| Plus | 229K | 18K | 123.75K | **54.0%** |
| Pro | 329K | 35K | 181.75K | **55.2%** |

Thus all paid plans remain above the requested **50% modeled contribution margin even at AI hard ceiling**.

Minimum price formula for the 50% floor under these assumptions:
`Minimum Price = 4 × (30K + AI_COGS)`.

Do not lower prices merely because actual AI COGS is lower. Use savings to improve margin, product quality and acquisition capacity until real pilot data supports repricing.

---

## 7. Internal AI Cost Unit / telemetry

Every AI/OCR call must log:
```yaml
ai_usage_event:
  user_id: pseudonymous_id
  child_id: pseudonymous_id
  plan: free|basic|plus|pro
  operation_type: vision_extract|skill_map|diagnose|generate|explain|verify|summary
  provider: openai|anthropic|google
  model: string
  input_tokens: integer|null
  cached_input_tokens: integer|null
  output_tokens: integer|null
  image_count: integer|null
  ocr_pages: integer|null
  estimated_cost_usd: decimal
  estimated_cost_vnd: integer
  latency_ms: integer
  confidence: decimal|null
  escalation_reason: string|null
  request_id: string
  created_at: timestamp
```

Dashboard by plan/cohort:
- AI COGS / MAU
- AI COGS / paid active user
- AI COGS / scan page
- AI COGS / worksheet
- AI COGS / diagnosis
- AI COGS / Parent Copilot session
- % deterministic/question-bank
- % Luna
- % advanced model
- escalation rate
- OCR fallback rate
- projected contribution margin

Traffic light:
- GREEN: projected margin >55%
- YELLOW: 50–55%
- RED: <50% → cost/routing intervention required

---

## 8. Budget enforcement behavior

Budget control must be graceful, not a broken-product hard stop.

Order of fallback:
1. deterministic engine;
2. Verified Question Bank;
3. cached verified result;
4. Luna low-cost path;
5. OCR only if beneficial;
6. advanced model only if policy allows;
7. defer non-critical AI generation / offer quota upgrade.

Never reduce safety, correctness validation, privacy or data-deletion behavior to save AI cost.

---

## 9. Provider abstraction

```ts
interface AIProviderAdapter {
  capability: 'vision_extract'|'classify'|'generate_problem'|'diagnose'|'explain'|'verify';
  provider: string;
  model: string;
  processingRegion?: string;
  crossBorder: boolean;
  trainingAllowed: boolean;
  providerRetention?: string;
  call(input: StructuredAIInput): Promise<StructuredAIOutput>;
}
```

Routing policy must be configuration-driven. No business rule should depend directly on `openai`, `anthropic` or `google` SDK objects.

---

## 10. Claude implementation instructions

1. Add this document to project source-of-truth as **commercial + AI cost constraints**, without changing locked educational MVP.
2. Update `CLAUDE.md`, architecture, AI orchestration and observability plan.
3. Build provider-neutral adapters for OpenAI, Anthropic and optional Google OCR.
4. Default configuration = Luna-first; advanced route remains benchmark-gated between Sonnet 5 and Terra.
5. Build per-operation confidence gate and cost gate.
6. Add pricing registry with effective dates; never hard-code public API prices into domain logic.
7. Implement usage telemetry and monthly plan budget ledger.
8. Add graceful fallback hierarchy.
9. Add tests proving hard ceilings and margin guardrails cannot be bypassed by retry/escalation loops.
10. Before enabling production advanced routing, run the real-image + math benchmark and submit a comparison report for approval.
11. Do not change public package prices without explicit approval.
12. Do not tune model choice solely on benchmark accuracy; use **quality × cost × latency × privacy/compliance**.

---

## 11. Decision status

**LOCK NOW**
- Public working prices: Free / 169K / 229K / 329K.
- 50% modeled contribution margin floor.
- AI budget targets and hard ceilings.
- Luna-first architecture.
- Provider adapter + telemetry + budget enforcement.
- OCR is optional/fallback and benchmark-driven.

**BENCHMARK BEFORE LOCKING**
- Sonnet 5 vs Terra as advanced production model.
- Google OCR fallback thresholds.
- Exact confidence thresholds.
- Per-operation token/image budgets.

**VALIDATE AFTER PILOT**
- Actual AI COGS by cohort.
- Conversion Free→Paid.
- scan frequency.
- advanced-model escalation rate.
- paid-plan mix.
- willingness to pay and annual-plan discount.
