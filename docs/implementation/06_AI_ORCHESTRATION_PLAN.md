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

- Track **token_in/out, cost, latency_ms** mỗi inference → dashboard + budget alert.
- Batch/caching cho generation lặp; cache theo (skill, problem_type, K, T).
- Safety: lọc nội dung, không rò rỉ PII của child vào prompt provider ngoài mức cần thiết.
- Fail-open cho học tập (fallback về ngân hàng câu hỏi authored) nhưng **fail-closed cho ghi state**.

---

## 7. Testing AI layer

- **Contract tests:** mọi schema có fixture valid/invalid.
- **Golden discrimination:** AI-assisted classification chạy trên golden cases (xem `08_GOLDEN_TEST_PLAN`) — nhưng phán quyết cuối do deterministic engine, nên golden tests **không phụ thuộc tính ngẫu nhiên của LLM**.
- **Mock provider** trong CI (không gọi mạng); provider thật chỉ ở integration test có gate.
