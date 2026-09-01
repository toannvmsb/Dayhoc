# Ngân hàng câu hỏi authored (D-03) — kế hoạch & tiến độ

> **⚠ ĐANG ĐƯỢC REFRAME (migration v1.1, chờ anh duyệt).** Quyết định
> **AI_GENERATION_FIRST**: các file `questions*.json` KHÔNG còn là nguồn phát bài
> chính. Chúng trở thành **Reference / Grounding Library** (ví dụ họ bài, few-shot
> cho generator, tham chiếu validation, golden fixtures). Nội dung 22 câu nháp
> vẫn giữ nguyên giá trị. Xem `docs/implementation/14_AI_EXERCISE_GENERATION_ARCHITECTURE.md`.
> Doc này sẽ đổi tên thành `REFERENCE_LIBRARY_AND_GROUNDING_PLAN.md` khi migration
> được duyệt.

> **Quyết định anh chốt Q5 (2026-09-01):** *"Em sinh nháp từ problem-type của
> Dev Core → anh / GV duyệt & sửa."*
>
> Hai tầng:
> - `packages/practice/src/data/questions.json` — **GV duyệt, final** (`origin: authored`)
> - `packages/practice/src/data/questions.ai-draft.json` — **nháp AI, chờ GV** (`origin: ai_generated`, id có `.AI.`)
>
> Cả hai qua cùng schema (`question-bank.ts`): prompt · answerSpec · **đủ 6 bậc gợi ý** · workedSolution.

---

## Tiến độ

| | Authored (final) | AI-draft (chờ GV) | Tổng |
|---|---:|---:|---:|
| Batch 0 (P5) | 7 | — | 7 |
| **Batch 1 (2026-09-01)** | — | **22** | **29** |

**Batch 1 phủ 17 skill:** M4 — FRAC.ADD, FRAC.SUB, FRAC.SIMPLIFY, FRAC.EQUIVALENT,
FRAC.COMMON_DENOM, ARITH.DISTRIBUTIVE, ARITH.ESTIMATE, WORD.SUM_DIFF, WORD.UNIT_RATE,
MEAS.CONVERSION · M7 — RAT.OPERATIONS, RAT.ORDER_TRANSPOSE, RATIO.PROPORTION,
RATIO.EQUAL_CHAIN, ALG.POLY_ADD_SUB, ALG.POLY_MUL, TRI.ANGLE_SUM.

---

## Mục tiêu đầy đủ

100–200 câu, ưu tiên theo thứ tự:

1. **17 skill của golden dataset + pilot** (đang làm) — 4–6 câu/skill, trải K1–K3 / T1–T3, + 1 câu challenge T4–T5.
2. **Phần còn lại của M4** (52 skill) — tối thiểu 2 câu/skill.
3. **Phần còn lại của M7 chuẩn** (37 skill) — tối thiểu 2 câu/skill.
4. **5 family HSG** — 3–5 câu/family, T4–T5.

Ước tính ~160 câu để đạt "2 câu/skill + challenge cho skill lõi".

---

## Quy ước soạn (cho GV + cho batch sau)

- **id:** `Q.<SKILL_ID>.<NNN>` (final) hoặc `Q.<SKILL_ID>.AI.<NNN>` (nháp).
- **6 bậc gợi ý** theo thang cố định (Math Core §17):
  1. định hướng / chú ý (không cho phương pháp)
  2. thu hẹp
  3. nêu phương pháp
  4. ví dụ tương tự dễ hơn
  5. gần xong
  6. lời giải đầy đủ
- **answerSpec:** `exact` (chuỗi) · `numeric` (số + tolerance) · `fraction` · `choice` (2–4 phương án) · `reasoning` (câu mở, chấm định tính).
- **workedSolution:** 1–3 câu, cách trình bày như bài mẫu.
- Ngôn ngữ, ký hiệu, mức độ **bám SGK KNTT**; số liệu đời thường, không gài PII.
- `problem_type_id`: lấy từ Dev Core (`M4.PT.*` có sẵn; M7 dùng slug họ `G7.*` → em tạm đặt `M7.PT.<HỌ>.<KIỂU>`, **GV xác nhận danh mục problem-type M7 khi duyệt**).

---

## Quy trình duyệt

1. GV mở `questions.ai-draft.json`, sửa trực tiếp (prompt / đáp án / gợi ý).
2. Câu nào OK → chuyển sang `questions.json`, đổi `origin` thành `authored`, bỏ `.AI.` khỏi id.
3. Câu nào bỏ → xoá khỏi file nháp.
4. Test `packages/practice/src/practice.test.ts` giữ mọi câu (cả 2 tầng) đúng schema + 6 gợi ý.

**Chưa dùng câu `ai_generated` cho đánh giá chính thức** — routing coi bank-hit hợp lệ
chỉ khi có câu phù hợp; nếu chỉ có nháp, GV nên duyệt trước khi pilot.
