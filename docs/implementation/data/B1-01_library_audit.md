# B1-01 — kiểm tra tự động thư viện câu hỏi

Sinh bởi `scripts/audit-question-library.mjs` (seed 1). Chỉ đọc thư viện, không sửa gì.

* Tổng số câu: **9744** · số kỹ năng: **94**
* Tính lại bằng số học chính xác: **VERIFIED 3247** (33.3%) · **FAIL 0** · chưa kiểm được 6497 (66.7%) — cần giáo viên đọc
* Lỗi chắc chắn (ERROR): **0**

## Phát hiện theo loại

* WARN DUP_PROMPT: 4
* WARN VERSION_TAG: 3015

## Phân bố K/T

* K1/T1: 2439
* K2/T1: 9
* K2/T2: 3526
* K2/T3: 105
* K2/T5: 2
* K3/T3: 3236
* K3/T4: 234
* K3/T5: 51
* K4/T4: 142

Kỹ năng chưa có câu K1: (không)

## Lỗi chắc chắn (tối đa 60 dòng đầu)

* (không có)

## Cảnh báo cần giáo viên/anh quyết định

**DUP_PROMPT** (4):
* `Q.M4.FRAC.COMMON_DENOM.003` — same as Q.M4.FRAC.COMMON_DENOM.001
* `Q.M4.FRAC.EQUIVALENT.002` — same as Q.M4.FRAC.EQUIVALENT.001
* `Q.M4.ARITH.DISTRIBUTIVE.002` — same as Q.M4.ARITH.DISTRIBUTIVE.CHALLENGE.001
* `Q.M4.FRAC.EQUIVALENT.AI.001` — same as Q.M4.FRAC.EQUIVALENT.003

`VERSION_TAG`: nhãn khuôn mẫu như “[Phiên bản N]”, “(Mẫu 1)”, “(Tình huống 1-Thấp)” nằm trong đề; đã được lọc khi nạp thư viện (`childFacingPrompt`), file dữ liệu giữ nguyên.

## Lưu ý về nguồn gốc

Các câu đều ghi `origin: authored`, nhưng chúng được dựng từ khuôn mẫu: cùng một lõi bài được bọc bằng nhiều câu dẫn (“Giải bài toán sau:”, “Một bạn đưa ra kết luận…”, “[Phiên bản N]”). Việc có đánh dấu lại thành `ai_generated`/`template` hay không do anh quyết định — báo cáo này không đổi dữ liệu.

File giáo viên rà: `B1-01_review_sample.csv` — 2820 dòng (30/kỹ năng, ưu tiên câu máy chưa kiểm được). Cột cuối để giáo viên điền Y/N.
