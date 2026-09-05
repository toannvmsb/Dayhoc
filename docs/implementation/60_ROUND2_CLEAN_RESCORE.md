# 60 — ROUND 2 CLEAN RE-SCORE (doc 59 follow-up)

> 2026-09-06. Theo chỉ thị "ROUND 2 CLEAN RESCORE BEFORE PAID RERUN".
> **KHÔNG có call model có phí trong phase này.**

---

## 0. TL;DR

1. **P1 (LINEAR_EQ) đã vá xong** — validate theo **vai trò toán học**, không theo token chuỗi:
   hằng số âm hiện dưới dạng phép trừ (`ax − |b| = c`) giữ đúng vai trò của `b`; hằng số 0 là
   ẩn; lexicon `SOLVE_EQUATION` mở rộng thận trọng + nhận **hình dạng phương trình**
   (`[chữ] … = số`). `SEMANTIC_STRUCTURE_MISMATCH` cho SOLVE_EQUATION giờ dựa trên *có phương
   trình để giải hay không*, không dựa trên *thiếu từ khoá số học*. 4 regression test mới.
2. **Full free regression xanh**: 715 unit test + 26 kernel-integrity + typecheck web + typecheck
   mobile + toàn bộ golden/e2e/child-projection. 0 fail.
3. **Offline re-score có GIỚI HẠN**: raw model output (đề + lời giải) **không được lưu** —
   sidecar `ROUND2_raw.jsonl` chỉ được thêm ở commit `2aa3579` **SAU KHI** Round 2 đã chạy. Vì
   vậy đây **không phải** re-score toàn pipeline; đây là **phân loại lại theo luật** từng dòng
   `failureDetail` đã ghi, quyết định validator đã vá còn flag item đó nữa không.
   `scripts/round2-rescore.mjs` (deterministic, tái lập được).
4. **Tỉ lệ false-positive của validator CŨ** (trên số item bị loại đã ghi):
   **gpt-4o-mini 7.3% · gpt-4.1-mini 53.3% · gpt-5-mini 47.2%** — cộng thêm 1/1/7… wait
   (UNRESOLVED: 8 / 1 / 7 item không phân định được nếu thiếu text).
5. **Con số hiệu chỉnh** (cận dưới; coi UNRESOLVED = vẫn hỏng):

| CONTENT acceptance sau ≤1 retry | as-run | **hiệu chỉnh** |
|---|---|---|
| gpt-4o-mini | 78.8% | **80.4%** |
| gpt-4.1-mini | 75.4% | **87.7%** |
| gpt-5-mini | 85.2% | **92.2%** |

6. **Xếp hạng:** gpt-5-mini thắng về độ tin cậy / hoàn thành worksheet / leakage-uniqueness /
   retry; gpt-4o-mini thắng về giá & độ trễ; **gpt-4.1-mini bị lấn át** (kém 5-mini về chất,
   kém 4o-mini về giá). **CHƯA chọn model production.**
7. **Đề xuất: 1 lần verification CÓ PHÍ NHỎ** — 6 spec đại diện, 3 model, MODE A, ≤1 retry,
   **hard cap $0.35**, lần này `ROUND2_raw.jsonl` lưu đủ. Chờ anh duyệt. **ĐÃ DỪNG.**

---

## 1. P1 FIX — LINEAR_EQ theo vai trò toán học

`packages/exercise-gen/src/kernel-validator.ts`:

### §2 — kiểm số cho trước theo VAI TRÒ
```
- số 0 là toán hạng ẩn → không bao giờ tính là "bị bỏ";
- family LINEAR_EQ: hằng số b < 0 mang dấu bởi phép ± của phương trình,
  nên "x - 14 = 21" GIỮ ĐÚNG vai trò của b = -14  (promptNums.has(-n) ⇒ ok).
```

### §5 — SEMANTIC_STRUCTURE_MISMATCH cho SOLVE_EQUATION
`SOLVE_EQUATION` **không** còn đi qua heuristic "underEachOp" (toán hạng `a·x ± b = c` KHÔNG
kết hợp ra đáp án). Thay bằng: đề phải có **hình dạng phương trình** —
`/[chữ]\s*[-+×·*/:]?\s*\d …\s*=\s*[-+]?\d/`, hoặc kết ` = <số>` ở cuối, hoặc khớp lexicon.
Không có → mới flag. `SOLVE_EQUATION` cũng bị loại khỏi vòng lặp "other" của các op khác
(hình dạng phương trình ≠ một cách đọc số học cạnh tranh).

### Lexicon `OP_KEYWORDS.SOLVE_EQUATION` (mở rộng thận trọng)
thêm: `tìm <chữ>` · `tìm số` · `số (cần|phải|chưa) (tìm|biết)` · `số nào` · `chuyển vế` ·
`ẩn số` · `giá trị của <chữ>` · `biết [rằng] : <chữ>` · hình-dạng-phương-trình.

### Regression (`kernel-integrity.test.ts`, `describe('doc 59 P1 …')`)
- b < 0 hiện dạng `ax − |b| = c` → **không** `KERNEL_NUMBER_DROPPED`, **không**
  `SEMANTIC_STRUCTURE_MISMATCH`;
- b = 0 (`ax = c`) → 0 ẩn không phải số bị bỏ;
- đề dạng lời ("Tìm số cần tìm, biết … nhân … rồi cộng …") → thoả `SOLVE_EQUATION`;
- đề KHÔNG có phương trình & KHÔNG có ngôn ngữ "tìm" → **vẫn** flag.

---

## 2. FULL FREE REGRESSION

| kiểm | kết quả |
|---|---|
| unit tests (vitest, toàn repo) | **715 pass / 44 skip / 0 fail** |
| kernel integrity (`kernel-integrity.test.ts`) | 26 pass (7000 kernel instance vs oracle vẫn 100%) |
| typecheck web (`tsc --noEmit`) | clean |
| typecheck mobile (`tsc --noEmit`) | clean |
| golden / e2e-journey / context-frontier / child-projection deny | trong 715, pass |
| mock kernel-coverage benchmark (offline, full validator) | kernelSupportedProduction 100%, kernelWrong 0%, deterministicWrong 0%, schema/skill/curriculum/prereq 100% — **không regression** |

---

## 3. OFFLINE RE-SCORE — phương pháp & GIỚI HẠN

**Không thể re-score toàn pipeline**: `ROUND2_raw.jsonl` không tồn tại (persistence thêm sau
khi Round 2 chạy). Dữ liệu có: `ROUND2.txt` + `ROUND2_m12.txt` — mỗi item bị loại có specId,
itemId, kernel family, failed gates, và `failureDetail` (cắt ~200 ký tự) chứa mã mâu thuẫn cụ
thể ("worked solution concludes 11, kernel answer is 759", "missing given number(s): -14"…).

`scripts/round2-rescore.mjs` phân loại lại **deterministic** từng dòng theo validator đã vá:

| tình huống trong detail | phán định |
|---|---|
| `SIMILARITY_OK … near_copy 1.00 / identical` | `TRUE_DUPLICATE` (vẫn hỏng) |
| `SIMILARITY_OK … vs reference` | `TRUE_LEAKAGE` (vẫn hỏng) |
| `SIMILARITY_OK … vs worksheet_sibling` (trigram/jaccard) | `TRUE_MODEL_CONTENT` (vẫn hỏng) |
| `SCHEMA_VALID` / "is not a number" / "hint rung" | `TRUE_MODEL_SCHEMA` (vẫn hỏng) |
| `KERNEL_NUMBER_DROPPED` chỉ với số ÂM bị thiếu | **`VALIDATOR_FALSE_POSITIVE`** (P1 — hết) |
| `SEMANTIC_STRUCTURE_MISMATCH`: "SOLVE_EQUATION but prose reads as …" | **`VALIDATOR_FALSE_POSITIVE`** (P1 — hết) |
| `SOLUTION_CONTRADICTS_KERNEL`: "concludes X, answer Y" với **X là thừa số/toán hạng sạch của Y** | **`VALIDATOR_FALSE_POSITIVE`** (P0 — bộ trích bắt toán hạng giữa bài) |
| `SOLUTION_CONTRADICTS_KERNEL`: X không có quan hệ thừa số với Y | **`UNRESOLVED_NEEDS_RERUN`** (cần text lời giải) |
| `ANSWER_MISMATCH`: value = kernel × 1000 / × 10000 | `TRUE_MODEL_KERNEL_DRIFT` (đáp án theo đơn vị nghìn — lỗi thật) |
| `ANSWER_MISMATCH` khác | `TRUE_MODEL_KERNEL_DRIFT` |
| `SEMANTIC_STRUCTURE_MISMATCH` op khác (FRACTION add↔sub, PROPORTION↔division) | `TRUE_MODEL_KERNEL_DRIFT` (validator không đổi ở đây → vẫn hỏng) |
| `KERNEL_NUMBER_DROPPED` số DƯƠNG bị thiếu (không phải "1, 1") | `TRUE_MODEL_KERNEL_DRIFT` |

**"never states the correct result Y"** và **ratio "1, 1"** → `UNRESOLVED_NEEDS_RERUN`.

---

## 4. CORRECT FAILURE TAXONOMY

| category | gpt-4o-mini | gpt-4.1-mini | gpt-5-mini |
|---|---|---|---|
| recorded failures (as-run) | 55 | 60 | 36 |
| **VALIDATOR_FALSE_POSITIVE (validator cũ)** | **4** | **32** | **17** |
| UNRESOLVED_NEEDS_RERUN | 8 | 1 | 7 |
| TRUE_MODEL_CONTENT (trùng mềm sibling) | 16 | 18 | 5 |
| TRUE_MODEL_KERNEL_DRIFT | 17 *(≈8 là "×1000")* | 5 | **0** |
| TRUE_MODEL_SCHEMA | 2 | 1 | 4 |
| TRUE_LEAKAGE | 1 | 0 | 1 |
| TRUE_DUPLICATE (near-copy/identical) | 7 | 3 | 2 |
| KERNEL_DEFECT | 0 | 0 | 0 |
| INFRA (thật) | 0 | 0 | 0 |

### Tỉ lệ false-positive của validator CŨ

| | trên số item bị loại đã ghi | trên toàn bộ item base |
|---|---|---|
| gpt-4o-mini | **7.3%** (tối đa 21.8% nếu mọi UNRESOLVED cũng là FP) | 1.5 pp (tối đa 4.6) |
| gpt-4.1-mini | **53.3%** (tối đa 55.0%) | 12.3 pp |
| gpt-5-mini | **47.2%** (tối đa 66.7%) | 7.0 pp (tối đa 9.8) |

> Vì sao gpt-4o-mini FP thấp còn 2 mini kia cao: lỗi của gpt-4o-mini **phần lớn là THẬT**
> (đáp án ×1000, trùng lặp, nội dung mềm). Lỗi của 4.1-mini / 5-mini **phần lớn là artifact
> P0** (bộ trích "final claim" bắt toán hạng: `11/759`, `165/11`, `20/860`, `15/615` …). Điều
> này làm **sắc nét hơn** xếp hạng — gpt-4o-mini trông "ở giữa" nhưng thực ra **YẾU NHẤT** về
> chất lượng model thật; gpt-5-mini mạnh nhất.

---

## 5. CLEAN PER-MODEL METRICS (hiệu chỉnh; cận dưới = UNRESOLVED tính là hỏng)

| | gpt-4o-mini | gpt-4.1-mini | gpt-5-mini |
|---|---|---|---|
| schema / skill / curriculum / prereq / K / T | 100% (không đổi) | 100% | 100% |
| reference leakage pass | 88.1% | 91.5% | **96.7%** |
| sibling uniqueness pass | 97.7% | 98.8% | **99.6%** |
| kernel consistency (của item được nhận) | 100% | 100% | 100% |
| **true kernel drift** | ~17 *(≈8 "×1000")* | **5** | **0** |
| answer mismatch (thật) | ~9 | ~2 | 0 |
| semantic mismatch (thật, non-SOLVE_EQ) | ~3 | ~4 | 0 |
| solution contradiction (thật) | **0 xác định được** — mọi cái đã kiểm là FP hoặc UNRESOLVED | 0 | 0 |
| **CONTENT first-pass** (hiệu chỉnh) | ~55% → **~58%** | ~62% → **~74%** | ~73% → **~80%** |
| **CONTENT sau ≤1 retry** (hiệu chỉnh) | **80.4%** (cận trên 83.5%) | **87.7%** (88.1%) | **92.2%** (95.1%) |
| **PRODUCTION-ready first-pass** (hiệu chỉnh) | ~55% | ~64% | ~72% |
| **PRODUCTION-ready sau ≤1 retry** (hiệu chỉnh) | **68.5%** (70.0%) | **76.2%** (76.5%) | **80.3%** (83.2%) |
| kernel-supported production sau ≤1 retry | **77.7%** (79.5%) | **86.5%** | **91.6%** (94.9%) |
| crosscheck-required | ~15% | ~15% | ~14% |
| **rejected** (hiệu chỉnh) | **~19.6%** (16.5%) | **~12.3%** (11.9%) | **~7.8%** (4.9%) |
| cost / accepted item | **~15 VND** | ~43 VND | ~55 VND |
| latency p50 / p95 (ms) | **2 100 / 2 973** | 3 604 / 6 228 | 7 371 / 13 883 |
| avg retries / item | 0.37 | 0.38 | **0.27** |

---

## 6. PRODUCT-LEVEL METRICS

### VALID ITEM SUCCESS RATE (item production-ready / tổng item yêu cầu, hiệu chỉnh cận dưới)
| gpt-4o-mini | gpt-4.1-mini | gpt-5-mini |
|---|---|---|
| **68.5%** | **76.2%** | **80.3%** |

### FULL WORKSHEET SUCCESS RATE (mọi kernel-item của worksheet production-ready)
| | gpt-4o-mini | gpt-4.1-mini | gpt-5-mini |
|---|---|---|---|
| as-run first-pass | 11.5% | 7.7% | 16.0% |
| as-run sau ≤1 retry | 23.1% (6/26) | 15.4% (4/26) | 36.0% (9/25) |
| **hiệu chỉnh sau ≤1 retry (ước lượng)** | **~27% (7/26)** | **~38% (10/26)** | **~52–56% (13–14/25)** |

> Ước lượng: đếm số worksheet có **mọi** lỗi đã ghi đều chuyển thành pass. gpt-4.1-mini +6
> worksheet sạch, gpt-5-mini +5, gpt-4o-mini +1 (lỗi của nó phần lớn là thật).

### EFFECTIVE COST PER COMPLETED WORKSHEET
> worksheet chưa hoàn chỉnh **không** tính là hoàn thành.

| | tổng chi | worksheet hoàn thành (hiệu chỉnh) | **$ / worksheet hoàn thành** |
|---|---|---|---|
| gpt-4o-mini | $0.1171 | ~7 | **~$0.017** (~440 VND) |
| gpt-4.1-mini | $0.3677 | ~10 | **~$0.037** (~960 VND) |
| gpt-5-mini | $0.4690 (25 spec) | ~13 | **~$0.036** (~940 VND) |

gpt-4o-mini vẫn **rẻ nhất ~2×** cho mỗi worksheet hoàn thành, dù hoàn thành ít hơn — vì đơn
giá call thấp hơn 4–10×.

---

## 7. MODEL RANKING (không chọn production model)

| tiêu chí | #1 | #2 | #3 |
|---|---|---|---|
| 1. production reliability (lỗi model thật/​item) | **gpt-5-mini** (~3.7%) | gpt-4.1-mini (~10%) | gpt-4o-mini (~17%) |
| 2. worksheet completion | **gpt-5-mini** (~52%) | gpt-4.1-mini (~38%) | gpt-4o-mini (~27%) |
| 3. leakage / uniqueness | **gpt-5-mini** | gpt-4.1-mini | gpt-4o-mini |
| 4. retry burden | **gpt-5-mini** (0.27) | gpt-4o-mini (0.37) | gpt-4.1-mini (0.38) |
| 5. cost / completed worksheet | **gpt-4o-mini** (~$0.017) | gpt-5-mini (~$0.036) | gpt-4.1-mini (~$0.037) |
| 6. latency | **gpt-4o-mini** (p50 2.1s) | gpt-4.1-mini (3.6s) | gpt-5-mini (7.4s) |

**Kết luận xếp hạng:**
- **gpt-5-mini** — chất lượng & độ tin cậy tốt nhất rõ rệt; đắt nhất & chậm nhất.
- **gpt-4o-mini** — rẻ nhất & nhanh nhất; chất lượng model thật yếu nhất (đáp án ×1000, trùng lặp).
- **gpt-4.1-mini** — **bị lấn át**: kém 5-mini về chất, không rẻ hơn / nhanh hơn đủ để bù.

Lựa chọn thật = đánh đổi **chất lượng (5-mini) vs chi phí+độ trễ (4o-mini)** — quyết định sau
verification.

---

## 8. ĐỀ XUẤT PAID VERIFICATION (chờ anh duyệt)

Offline re-score **nhất quán nội bộ** và cơ chế FP đã hiểu rõ + đã vá + đã có regression. Còn
**16 item UNRESOLVED** (8 / 1 / 7) chỉ phân định được khi có text lời giải, và các con số §5–§6
là **ước lượng từ dòng detail bị cắt**, không phải re-score thật.

→ Đề xuất **1 lần verification có phí NHỎ**:

| tham số | giá trị |
|---|---|
| spec | **6** đại diện: `BENCH-LT-G4-02` (UNIT_RATE), `BENCH-LT-G4-07` (DISTRIBUTIVE, nhiều FP), `BENCH-LT-G7-04` (LINEAR_EQ âm), `BENCH-LT-G7-03` (RATIO_SHARE/UNIT_RATE), `HC06` (INT_ARITH + LINEAR_EQ), `HC03` (RATIO_SHARE — control ít FP) |
| model | gpt-4o-mini · gpt-4.1-mini · gpt-5-mini (KHÔNG gpt-4o) |
| mode | A (1 câu/call) |
| retry | ≤ 1 |
| **hard cap** | **USD 0.35** |
| raw output | `ROUND2_raw.jsonl` (đề + lời giải mỗi item — không PII trẻ em) |
| chạy | `RUN_ITEM_ROUND2=1 ROUND2_SPEC_IDS=<6 ids> ROUND2_BUDGET_USD=0.3 OPENAI_API_KEY=… npx vitest run …/item-round2.live.test.ts` |

Nếu verification **khớp** offline re-score (FP đã hết, true drift ≈ 0 cho gpt-5-mini, ×1000
vẫn hiện ở gpt-4o-mini) → **không cần** chạy lại full Round 2; kết luận xếp hạng đứng vững, chỉ
cần chọn điểm đánh đổi.
Nếu **lệch** → chạy lại full Round 2 (26 spec) trên validator đã vá.

**KHÔNG tự tiêu tiền.**

---

## 9. ĐÃ DỪNG

Không chạy: full paid Round 2 · MODE B · gpt-4o · paid crosscheck · LIVE generation · đổi
routing production. Dừng sau: P1 fix · regression · offline re-score · ranking · đề xuất
verification.
