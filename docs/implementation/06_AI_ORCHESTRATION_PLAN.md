# 06 — AI Orchestration Plan

> Authority: Technical Spec §6, §7. **AI KHÔNG sở hữu deterministic educational rules.** Mọi AI output phục vụ engine phải qua **JSON schema validation + confidence threshold + fallback**.

---

## 1. Nguyên tắc

1. **Deterministic core là chủ.** AI chỉ đề xuất *candidate*; engine deterministic mới ghi state.
2. **Providers replaceable.** LLM và OCR/Vision ẩn sau adapter interface; swap không đổi domain.
3. **Structured output only.** Không dùng free-text để cập nhật engine — luôn parse vào schema.
4. **Provenance đầy đủ.** Lưu model, prompt ref, raw output, confidence, latency, token, cost, safety flags (`ai_inferences`).
5. **Human-in-the-loop.** Scan/inference quan trọng cần **parent confirmation** trước khi ghi evidence.

---

## 2. AI use-cases (được phép) & tách nhiệm vụ

| Use-case | AI làm gì | Deterministic core làm gì |
|---|---|---|
| **Homework/test/notebook recognition** | OCR/vision → text/cấu trúc bài | Không |
| **Skill/problem mapping** | Đề xuất `candidate_skill_ids`, `problem_type_id`, K/T level | Chốt skill hợp lệ theo skill graph; ghi evidence |
| **Error classification** | Đề xuất `error_class`, `reasoning_quality` | Áp gap rules, cập nhật mastery/gap |
| **Question generation** | Sinh đề trong schema chặt (skill, problem_type, K/T) | Validate, chọn, gán vào assignment |
| **Hints & explanations** | Sinh hint ladder, giải thích parent-friendly | Kiểm tra an toàn nội dung, không đổi state |
| **Parent summaries** | Diễn đạt dễ hiểu (Con đang học gì…) | Cung cấp dữ liệu nguồn từ Twin/Gap |

**AI KHÔNG được:** sửa prerequisite graph, sửa mastery history, tự đóng gap, tự quyết Next Best Action ngoài rule, gán global grade level.

---

## 3. Structured Output Contract (Tech Spec §7)

Mọi inference trả JSON theo schema versioned. Ví dụ classification:

```jsonc
{
  "schema_version": "classify.v1",
  "candidate_skill_ids": ["M4.FRAC.COMMON_DENOM", "M4.FRAC.EQUIVALENT"],
  "problem_type_id": "P3",
  "knowledge_level": "K2",
  "thinking_level": "T2",
  "error_class": "prerequisite_gap | careless_error | ...",
  "reasoning_quality": "adequate | weak | strong",
  "confidence": 0.71,
  "explanation": "…parent-friendly…",
  "safety_flags": []
}
```

Pipeline validation:
```
build payload
  → minimizeForProvider(payload, provider.data_categories_allowed)   -- Privacy Arch §5
      · strip name/address/school/phone/full-profile unless task needs it
      · replace child_id with opaque child_ref hash
      · refuse if payload categories exceed provider allowance
      · refuse provider if training_allowed = true (child data)
LLM/OCR output
  → Zod parse (schema_version)          → fail ⇒ fallback
  → confidence ≥ threshold?             → no  ⇒ mark low_confidence → parent review
  → skill_ids ∈ skill graph?            → no  ⇒ drop invalid candidates
  → persist ai_inference (provenance)
  → surface as CANDIDATE (needs confirm) hoặc feed engine nếu tier cho phép
```

---

## 4. Provider adapters (`/packages/ai`)

```ts
interface LlmProvider {
  classify(input, schema): Promise<Validated<Classification>>;
  generateItems(spec, schema): Promise<Validated<Question[]>>;
  generateHint(context, schema): Promise<Validated<Hint>>;
  explain(context, schema): Promise<Validated<Explanation>>;
}
interface VisionProvider {
  extractDocument(uploadRef): Promise<Validated<ExtractedDoc>>;
}
```

- Adapter chuẩn hóa: ret/timeout, JSON-mode/tool-use, schema enforcement, cost/latency capture.
- Default provider: Claude (LLM) — pin model id ở config; giữ khả năng thay thế.
- Prompt templates versioned trong repo; prompt ref lưu vào `ai_inferences.prompt_ref`.

---

## 5. Confidence tiers → hành động

| Confidence | Hành động |
|---|---|
| High (≥ ngưỡng cao) | Vẫn cần parent confirm cho evidence quan trọng (scan) |
| Medium | Đánh dấu `low_confidence`, yêu cầu review trước khi ghi |
| Low / schema fail | Fallback: giữ nguyên, không mất dữ liệu, retry rõ ràng; không ghi evidence sai |

Confidence tier khác với **evidence confidence tier (A/B/C/D)** ở tầng domain — AI confidence là một input, không tự nâng evidence lên "verified".

---

## 6. Cost, latency & safety governance

- Track **token_in/out, cached_in, cost_usd/vnd, latency_ms, confidence, escalation_reason** mỗi inference → `ai_usage_events` (INSERT-only) → dashboard (`rollup`) + traffic light (`cogsPerUser`). Chi tiết: [PRICING_AND_COST_GUARDRAILS.md](PRICING_AND_COST_GUARDRAILS.md).
- Batch/caching cho generation lặp; cache theo (skill, problem_type, K, T).
- Safety: `minimizeForProvider` bắt buộc trước mọi call — không rò rỉ PII của child vào prompt provider. Provider cho child-data phải có `training_allowed = false` + DPA đã ký (`ai_provider_registry`).
- Fail-open cho học tập (fallback về ngân hàng câu hỏi authored) nhưng **fail-closed cho ghi state**.

---

## 7. Model routing & budget (Pricing v1.0 §3–§5, §8)

**Luna-first.** `resolveRoute(operation, ctx)` (`@copilot/ai` `routing.ts`) trả tier
theo `ROUTING_MATRIX`; mục tiêu **85–95%** call ở Luna / deterministic / question-bank.
Escalate chỉ khi đo được: confidence thấp, evidence mâu thuẫn, ứng viên nhập nhằng,
chữ viết tay / layout toán, hoặc K4–K5 / T4–T5. Advanced tier = `advancedModelPending`
cho tới khi benchmark chọn **Claude Sonnet 5 vs GPT-5.6 Terra** (§3.2).

**Budget gate trước mỗi metered call:** `checkBudget({ plan, state, estimatedCostVnd,
requestedTier, safetyCritical? })`:
- deterministic / question_bank / cache: không xét budget;
- trên target, dưới ceiling: tier rẻ vẫn chạy, `advanced` bị hạ xuống `luna`;
- sẽ vượt hard ceiling: từ chối, hạ 1 tier (`cheaperThan`);
- `safetyCritical` (privacy, xoá dữ liệu, kiểm chứng đúng/sai): luôn bypass budget (§8).

**Guardrail:** không vòng lặp retry/escalation nào đẩy chi phí vượt hard ceiling
(`simulateEscalationLoop`, test cho cả 4 gói).

Pipeline (mở rộng §3):
```
build payload → minimizeForProvider → resolveRoute(op, ctx) → checkBudget(...)
  → allow?  yes → provider.call  |  no → fallback tier / rescan / defer
  → Zod parse (schema_version) → confidence gate → graph validation
  → emit AiUsageEvent → persist ai_inference → CANDIDATE / feed engine
```

---

## 8. Testing AI layer

- **Contract tests:** mọi schema có fixture valid/invalid.
- **Golden discrimination:** AI-assisted classification chạy trên golden cases (xem `08_GOLDEN_TEST_PLAN`) — nhưng phán quyết cuối do deterministic engine, nên golden tests **không phụ thuộc tính ngẫu nhiên của LLM**.
- **Mock provider** trong CI (không gọi mạng); provider thật chỉ ở integration test có gate.
- **Cost/routing tests:** `@copilot/ai` `{pricing,routing,margin,budget,usage-event}.test.ts` — bảng margin §6 tái lập chính xác; guardrail hard-ceiling; Luna-first share ≥ 85%.
- **Benchmark harness:** `@copilot/testing` `src/benchmark/*` — validate scoring + hard gates + cost→margin; KHÔNG tự chọn provider (cần ảnh thật + ground truth người xác minh).
