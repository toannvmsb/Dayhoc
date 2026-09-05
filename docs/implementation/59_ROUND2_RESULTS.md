# 59 — ROUND 2 RESULTS (doc 58 §6–§10)

> Chạy 2026-09-05. 26 benchmark GenerationSpecs · MODE A (1 item/call) · ≤ 1 retry/item ·
> no fallback model · models `gpt-4o-mini` / `gpt-4.1-mini` / `gpt-5-mini` (KHÔNG gpt-4o) ·
> hard total spend cap **USD 1.00**. Production LIVE **không** bật. Paid crosscheck **không** chạy.
> Tổng chi: **~$0.954** (`$0.4848` cho 2 minis + `$0.4690` cho gpt-5-mini solo, dừng ở budget $0.45).
>
> **KERNEL_INTEGRITY_READY = true** đã xác lập trước Round 2 (commit `2f8204a`): 7 000 kernel
> instances (500 × 14 families) vs independent oracle → **100%**, 0 mismatch.

---

## 0. TL;DR — kết luận trung thực

1. **Kiến trúc lõi hoạt động.** Schema compliance / skill alignment / curriculum safety /
   prerequisite safety / K-conformity / T-conformity = **100.0% cho cả 3 model, cả 3.** Không
   còn phụ thuộc prompt wording. ExerciseGenerationSpec giữ quyền sở hữu — model chỉ verbalize.
2. **MathKernel *concept* hoạt động.** Của mọi item được chấp nhận: kernel-consistency-pass =
   **100%** cho cả 3 model. Không một item sai đáp số nào lọt qua gate.
3. **NHƯNG con số acceptance headline của Round 2 KHÔNG dùng được** — `SOLUTION_CONTRADICTS_KERNEL`
   và (với LINEAR_EQ) `KERNEL_NUMBER_DROPPED` có **false-positive có hệ thống** trong
   `kernel-validator`. Chúng làm `MODEL_KERNEL_DRIFT` phình lên thành nhóm lỗi lớn nhất và kéo
   sập CONTENT/PRODUCTION acceptance. Đây đúng là cái bẫy doc 58 §9 cảnh báo — **KHÔNG được
   giấu một defect của validator vào ô "MODEL failure"**. Report này gọi tên nó.
4. **Xếp hạng model sau khi trừ artifact:** `gpt-5-mini` sạch nhất rõ rệt (~1–2 lỗi toán thật /
   244 item), `gpt-4o-mini` có điểm yếu thật là "trả lời theo đơn vị nghìn" (`410` → `410 000`)
   ~8–10 lần, `gpt-4.1-mini` ở giữa (gần như toàn bộ "drift" của nó là artifact).
5. **Không thể tính lại con số chính xác** nếu không chạy lại (Round 2 harness cũ chỉ lưu report
   tóm tắt, không lưu worked solution). Đã vá validator + đã thêm lưu raw output (JSONL sidecar)
   để lần chạy sau re-score được offline.
6. **ĐÃ DỪNG** theo §10. Không MODE B, không gpt-4o, không LIVE, không paid crosscheck, không
   đổi routing production.

---

## 1. §7 — số liệu per-model (as-run, CHƯA trừ artifact validator)

| Metric | gpt-4o-mini | gpt-4.1-mini | gpt-5-mini |
|---|---|---|---|
| specs chạy | 26/26 | 26/26 | 25/26 (dừng ở budget) |
| model calls / items | 356 / 260 | 360 / 260 | 311 / 244 |
| schema pass (calls) | 100.0% | 100.0% | 100.0% |
| skill alignment | 100.0% | 100.0% | 100.0% |
| curriculum / prereq safety | 100% / 100% | 100% / 100% | 100% / 100% |
| K / T conformity | 100% / 100% | 100% / 100% | 100% / 100% |
| leakage pass (vs reference) | 88.1% | 91.5% | 96.7% |
| uniqueness pass (vs sibling) | 97.7% | 98.8% | 99.6% |
| MathKernel coverage | 88.1% (229/260) | 88.1% (229/260) | 87.7% (214/244) |
| kernel-consistency pass *(of accepted)* | 100.0% | 100.0% | 100.0% |
| kernel drift (rejected) | 28 | 45 | 26 |
| CONTENT acceptance — first pass | 63.1% | 61.5% | 72.5% |
| CONTENT acceptance — after ≤1 retry | **78.8%** | **75.4%** | **85.2%** |
| deterministic PRODUCTION-ready — first pass | 53.5% | 51.5% | 61.1% |
| deterministic PRODUCTION-ready — after ≤1 retry | **66.9%** | **63.8%** | **73.4%** |
| kernel-supported production after ≤1 retry | 76.0% (174/229) | 72.5% (166/229) | 83.6% (179/214) |
| AI-crosscheck-required (of content-accepted) | 15.1% | 15.3% | 13.9% |
| rejected | 21.2% | 24.6% | 14.8% |
| avg retries | 0.37 | 0.38 | 0.27 |
| latency p50 / p95 (ms) | 2 100 / 2 973 | 3 604 / 6 228 | 7 371 / 13 883 |
| tokens in / out | 473 142 / 76 879 | 477 735 / 110 364 | 410 768 / 183 151 |
| total cost | $0.1171 | $0.3677 | $0.4690 |
| cost / CONTENT item | ~15 VND | ~49 VND | ~59 VND |
| cost / PRODUCTION item | ~17 VND | ~58 VND | ~68 VND |

## 2. §8 — FULL WORKSHEET SUCCESS RATE (mọi kernel-item của worksheet đạt production-ready ≤1 retry)

| | gpt-4o-mini | gpt-4.1-mini | gpt-5-mini |
|---|---|---|---|
| first-pass | 11.5% (3/26) | 7.7% (2/26) | 16.0% (4/25) |
| after ≤1 retry | 23.1% (6/26) | 15.4% (4/26) | 36.0% (9/25) |

> Con số này thấp **chủ yếu vì cùng nhóm false-positive validator** + vì một worksheet chỉ cần
> **một** item bị FP là hỏng cả worksheet. Worksheet `BENCH-LT-G7-04` (LINEAR_EQ, có hằng số âm)
> hỏng ở **cả 3 model** — nguyên nhân gần như hoàn toàn là kernel-construction defect §5 dưới đây.

## 3. §9 — FAILURE TAXONOMY (as-run)

| category | gpt-4o-mini | gpt-4.1-mini | gpt-5-mini |
|---|---|---|---|
| MODEL_CONTENT (trùng lặp mềm với sibling) | 18 | 15 | 4 |
| MODEL_KERNEL_DRIFT | 28 | 45 | 26 |
| MODEL_SCHEMA | 2 | 1 | 4 |
| LEAKAGE (vs reference) | 1 | 0 | 1 |
| DUPLICATE | 0 | 0 | 0 |
| KERNEL | 0 | 0 | 0 |
| VALIDATOR | 0 | 0 | 0 |
| VERIFIER | 0 | 0 | 0 |
| INFRA | 6 | 3 | 1 |
| OTHER | 0 | 0 | 0 |

> `INFRA` bị thổi lên vì regex phân loại cũ khớp `\b4\d\d\b` — bất kỳ số 3 chữ số 400–499 nào
> trong detail ("worked solution concludes 489…") cũng bị gán INFRA. Đã vá (chỉ khớp khi có ngữ
> cảnh HTTP status / rate limit / timeout / ECONN). Không có INFRA failure thật đáng kể ngoài
> một vài timeout của gpt-5-mini.

---

## 4. FINDING P0 — `SOLUTION_CONTRADICTS_KERNEL` false-positive (validator, KHÔNG phải model)

### Bằng chứng
Trong log, gần như **mọi** `SOLUTION_CONTRADICTS_KERNEL` có dạng *"worked solution concludes X,
kernel answer is Y"* với **X là một thừa số / toán hạng sạch của Y**:

| ví dụ (concludes → kernel) | quan hệ |
|---|---|
| 11 → 759 | 759 = 69 × **11** |
| 20 → 760 | 760 = 38 × **20** |
| 14 → 392 | 392 = 28 × **14** |
| 15 → 615 | 615 = 41 × **15** |
| 11 → 165 (xuất hiện 3×) | 165 = 15 × **11** |
| 18 → 738 | 738 = 41 × **18** |
| 7 → 315 | 315 = 45 × **7** |
| 9 → 90 · 9 → 117 · 5 → 35 · 3 → 21 · 6 → 72 … | tất cả unit-rate: X = tổng / số phần |

Một model không thể "trôi" ngẫu nhiên đúng bằng `đáp_án / 11` hay `đáp_án / 15` **hàng chục
lần trên cả 3 model**. Nguyên nhân là bộ trích "final claim" cũ:

```
/(?:đáp\s*số|kết\s*quả|vậy)[^0-9-]*(-?\d+)/i   // rồi fallback: số sau dấu "=" cuối cùng
```

Với lời giải DISTRIBUTIVE / UNIT_RATE nhiều bước ("Ta có 11 × 69. **Vậy** ta tách 69 = 70 − 1…
… = 759."), regex bắt **số ngay sau "Vậy/kết quả" đầu tiên** — là một toán hạng giữa chừng
(11), không phải kết luận (759). Đáp án đúng 759 **có** xuất hiện trong lời giải, chỉ là ở
cuối.

### Đã vá (`kernel-validator.ts`, `KERNEL_VALIDATOR_VERSION` giữ `v2`)
`SOLUTION_CONTRADICTS_KERNEL` giờ chỉ bắn khi **chắc chắn**:
- (a) đáp án đúng **không xuất hiện ở bất kỳ đâu** trong lời giải; **hoặc**
- (b) có câu chốt tường minh `Đáp số / Đáp án / kết luận [:|là|=] X` với `X ≠ đáp án` **và**
  đáp án đúng không xuất hiện *sau* câu chốt đó.

Heuristic "số sau dấu `=` cuối cùng" — nguồn nhiễu chính — đã **bỏ**. `answerSpec` vẫn được
kiểm độc lập với kernel qua `ANSWER_MISMATCH`, nên một lời giải diễn giải cẩu thả nhưng đáp án
đúng vẫn bị hạ mức (không production-ready) chứ không bị loại nhầm.

Regression test mới trong `kernel-integrity.test.ts`:
- lời giải nhiều bước có nhắc toán hạng trước khi ra đáp án đúng → **không** flag.
- câu chốt `Đáp số: <sai>` → **vẫn** flag.

---

## 5. FINDING P1 — LINEAR_EQ hằng số âm: `KERNEL_NUMBER_DROPPED` + `SEMANTIC_STRUCTURE_MISMATCH` giả

Kernel dựng phương trình kiểu `x + (−14) = 21`, yêu cầu token `"-14"` xuất hiện trong đề **và**
yêu cầu ngôn ngữ SOLVE_EQUATION. Một đề hợp lệ hoàn toàn — *"Tìm x, biết: x − 14 = 21"* — viết
`14` (không phải `-14`) và đọc như phép trừ. → false `KERNEL_NUMBER_DROPPED` (thiếu `-14`) và
đôi khi false `SEMANTIC_STRUCTURE_MISMATCH`. Làm hỏng gần trọn worksheet `BENCH-LT-G7-04` ở cả
3 model.

### Đã vá (một phần)
`kernel-validator.ts` §2: một hằng số âm hiện dưới dạng phép trừ (`x − 14` cho token yêu cầu
`-14`) **không** còn tính là bị bỏ (`n < 0 && promptNums.has(|n|)`). Regression test đã thêm.

### Còn lại (khuyến nghị, chưa làm)
- `math-kernel.ts` LINEAR_EQ nên **sinh và yêu cầu** dạng tự nhiên (`x − 14 = 21`, không phải
  `x + (−14)`), hoặc oracle/validator so khớp theo giá trị tuyệt đối + dấu toán tử.
- `OP_KEYWORDS.SOLVE_EQUATION` nên nhận thêm *"tìm số"*, *"số cần tìm"*, *"số nào"* để không
  phạt đề đặt bài không dùng ký hiệu `x`.

---

## 6. Lỗi model THẬT (không phải artifact) — đáng sửa forward

| lỗi | model | tần suất | ghi chú |
|---|---|---|---|
| đáp án theo đơn vị "nghìn" (`495` → `495 000`) | **gpt-4o-mini** | ~8–10 | điểm yếu thật của gpt-4o-mini; 4.1-mini / 5-mini gần như không mắc |
| trả `answerSpec` là chữ cái MC ("B") cho item numeric | 4o-mini ×1, 5-mini ×2, 4.1-mini ×1 | hiếm | compose gate bắt được, → retry |
| fraction trả `"\frac{1}{2}"` / `"A = B"` thay vì `{num,den}` | 4.1-mini ×1, 5-mini ×1 | hiếm | schema gate bắt được |
| trùng lặp mềm giữa các câu cùng worksheet (trigram 0.6–0.9) trên worksheet 16 câu | cả 3, 4o-mini nhiều nhất | trung bình | gate similarity đang bắt; cần đa dạng hoá scenario khi sinh nhiều câu cùng skill |
| hint ladder trả 3 rung thay vì 6 | gpt-4o-mini ×2 | hiếm | |
| reference leakage (trigram vs reference 0.73–0.77) | 4o-mini ×1, 5-mini ×1 | hiếm | ProblemDNA de-anchoring hoạt động tốt tổng thể |

---

## 7. Xếp hạng định tính sau khi trừ artifact validator

> Con số chính xác cần một lần chạy lại (đã vá + đã bật lưu raw). Ước lượng dưới đây dựa trên
> phân loại thủ công 36 / 55 / 60 dòng failed-item trong log.

| | gpt-4o-mini | gpt-4.1-mini | gpt-5-mini |
|---|---|---|---|
| lỗi toán model **thật** (ước lượng / tổng item) | ~12–15 / 260 | ~3–5 / 260 | ~1–2 / 244 |
| CONTENT acceptance sau retry (ước lượng đã hiệu chỉnh) | ~88–90% | ~92–94% | **~94–96%** |
| điểm mạnh | rẻ nhất (~10–15× so với 5-mini), nhanh nhất (p95 3s) | cân bằng | chính xác nhất, ít retry nhất, leakage/uniqueness tốt nhất |
| điểm yếu | "×1000" formatting, trùng lặp sibling nhiều | không có điểm yếu nổi bật | chậm (p95 ~14s), token out cao nhất → đắt nhất |

**Chưa chọn model.** Quyết định cần chạy lại trên validator đã vá.

---

## 8. Thay đổi đã commit trong phase này

- `kernel-validator.ts` — `SOLUTION_CONTRADICTS_KERNEL` conservative (finding P0);
  `KERNEL_NUMBER_DROPPED` bỏ qua hằng số âm hiện dưới dạng phép trừ (finding P1).
- `kernel-integrity.test.ts` — 2 regression test mới (23 test, xanh).
- `item-orchestrator.ts` — `ItemRunRecord.lastPrompt` + `lastWorkedSolution` (lưu prompt +
  lời giải lần thử cuối, kể cả khi bị loại) để re-score offline không cần chạy lại có phí.
- `item-round2.live.test.ts` — ghi `ROUND2_raw.jsonl` (JSONL sidecar, mỗi item 1 dòng: prompt
  + worked solution + gates + detail); regex phân loại `INFRA` không còn khớp số 3 chữ số trần.
- `.gitignore` — `ROUND*.jsonl`.
- Full suite: **712 test xanh / 44 skip / 0 fail.**

---

## 9. Khuyến nghị (chờ anh duyệt — KHÔNG tự làm)

1. **Chạy lại Round 2** trên validator đã vá — cùng 26 spec, MODE A, ≤1 retry, cùng 3 mini,
   hard cap giữ **USD 1.00**. Lần này `ROUND2_raw.jsonl` sẽ lưu đủ để mọi phân tích về sau làm
   offline. Đây là cách duy nhất có con số acceptance đáng tin.
2. Trước hoặc song song: vá nốt finding P1 phần "còn lại" (LINEAR_EQ sinh dạng tự nhiên +
   SOLVE_EQUATION lexicon) — thuần deterministic, không tốn phí.
3. Sau khi có con số sạch: mới xét §10 kế tiếp (MODE B / gpt-4o control / routing) — **từng
   cái một, chờ duyệt**.

**Không** MODE B. **Không** gpt-4o. **Không** LIVE. **Không** paid crosscheck. **Không** đổi
routing production. Đã DỪNG.
