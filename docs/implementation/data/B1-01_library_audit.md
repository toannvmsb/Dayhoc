# B1-01 — kiểm tra tự động thư viện câu hỏi

Sinh bởi `scripts/audit-question-library.mjs` (seed 1). Chỉ đọc thư viện, không sửa gì.

* Tổng số câu: **9433** · số kỹ năng: **94**
* Tính lại bằng số học chính xác: **VERIFIED 3247** (34.4%) · **FAIL 0** · chưa kiểm được 6186 (65.6%) — cần giáo viên đọc
* Lỗi chắc chắn (ERROR): **0**

## Phát hiện theo loại

* WARN DUP_PROMPT: 4
* WARN NEGATIVE_DIFFERENCE: 28
* WARN VERSION_TAG: 3015

## Phân bố K/T

* K1/T1: 2418
* K2/T1: 9
* K2/T2: 3526
* K2/T3: 1
* K2/T5: 2
* K3/T3: 3236
* K3/T4: 98
* K3/T5: 1
* K4/T4: 142

Kỹ năng chưa có câu K1: M7.GEO.EUCLID_PARALLEL, M7.GEO.THEOREM_PROOF, M7.GEO.PARALLEL_CRITERIA, M7.RATIO.MULTIVAR, M7.ALG.SYMMETRIC, M7.ALG.FACTOR, M7.PROOF.ALGEBRA

## Lỗi chắc chắn (tối đa 60 dòng đầu)

* (không có)

## Cảnh báo cần giáo viên/anh quyết định

**NEGATIVE_DIFFERENCE** (28):
* `Q.M7.DATA.LINE_CHART.010` — ghi 5 giá trị liên tiếp: 31, 48, 42, 29, 26. Giá trị cuối hơn giá trị đầu → -5 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.014` — ghi 5 giá trị liên tiếp: 42, 24, 37, 11, 22. Giá trị cuối hơn giá trị đầu → -20 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.017` — ghi 5 giá trị liên tiếp: 20, 20, 20, 25, 14. Giá trị cuối hơn giá trị đầu → -6 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.025` — ghi 5 giá trị liên tiếp: 35, 44, 29, 17, 23. Giá trị cuối hơn giá trị đầu → -12 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.026` — ghi 5 giá trị liên tiếp: 35, 35, 43, 33, 15. Giá trị cuối hơn giá trị đầu → -20 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.027` — ghi 5 giá trị liên tiếp: 41, 41, 32, 12, 28. Giá trị cuối hơn giá trị đầu → -13 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.029` — ghi 5 giá trị liên tiếp: 50, 17, 18, 28, 19. Giá trị cuối hơn giá trị đầu → -31 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.031` — ghi 5 giá trị liên tiếp: 43, 41, 23, 48, 41. Giá trị cuối hơn giá trị đầu → -2 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.034` — ghi 5 giá trị liên tiếp: 50, 30, 42, 28, 34. Giá trị cuối hơn giá trị đầu → -16 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.035` — ghi 5 giá trị liên tiếp: 20, 41, 38, 49, 18. Giá trị cuối hơn giá trị đầu → -2 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.041` — ghi 5 giá trị liên tiếp: 44, 24, 41, 33, 10. Giá trị cuối hơn giá trị đầu → -34 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.044` — ghi 5 giá trị liên tiếp: 21, 15, 47, 16, 16. Giá trị cuối hơn giá trị đầu → -5 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.047` — ghi 5 giá trị liên tiếp: 16, 45, 25, 33, 13. Giá trị cuối hơn giá trị đầu → -3 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.048` — ghi 5 giá trị liên tiếp: 47, 38, 48, 19, 23. Giá trị cuối hơn giá trị đầu → -24 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.051` — ghi 5 giá trị liên tiếp: 38, 19, 18, 27, 36. Giá trị cuối hơn giá trị đầu → -2 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.053` — ghi 5 giá trị liên tiếp: 45, 35, 37, 50, 24. Giá trị cuối hơn giá trị đầu → -21 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.056` — ghi 5 giá trị liên tiếp: 42, 34, 48, 25, 36. Giá trị cuối hơn giá trị đầu → -6 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.059` — ghi 5 giá trị liên tiếp: 38, 17, 21, 43, 34. Giá trị cuối hơn giá trị đầu → -4 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.061` — ghi 5 giá trị liên tiếp: 18, 43, 36, 47, 12. Giá trị cuối hơn giá trị đầu → -6 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.063` — ghi 5 giá trị liên tiếp: 28, 18, 48, 40, 15. Giá trị cuối hơn giá trị đầu → -13 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.064` — ghi 5 giá trị liên tiếp: 34, 50, 45, 22, 27. Giá trị cuối hơn giá trị đầu → -7 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.065` — ghi 5 giá trị liên tiếp: 21, 17, 10, 39, 20. Giá trị cuối hơn giá trị đầu → -1 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.067` — ghi 5 giá trị liên tiếp: 39, 28, 49, 29, 37. Giá trị cuối hơn giá trị đầu → -2 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.071` — ghi 5 giá trị liên tiếp: 29, 17, 33, 14, 18. Giá trị cuối hơn giá trị đầu → -11 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.075` — ghi 5 giá trị liên tiếp: 21, 43, 37, 12, 20. Giá trị cuối hơn giá trị đầu → -1 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.079` — ghi 5 giá trị liên tiếp: 48, 19, 27, 34, 31. Giá trị cuối hơn giá trị đầu → -17 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.083` — ghi 5 giá trị liên tiếp: 47, 21, 15, 26, 22. Giá trị cuối hơn giá trị đầu → -25 (“hơn bao nhiêu” cho số âm)
* `Q.M7.DATA.LINE_CHART.095` — ghi 5 giá trị liên tiếp: 36, 36, 31, 50, 13. Giá trị cuối hơn giá trị đầu → -23 (“hơn bao nhiêu” cho số âm)

**DUP_PROMPT** (4):
* `Q.M4.FRAC.COMMON_DENOM.003` — same as Q.M4.FRAC.COMMON_DENOM.001
* `Q.M4.FRAC.EQUIVALENT.002` — same as Q.M4.FRAC.EQUIVALENT.001
* `Q.M4.ARITH.DISTRIBUTIVE.002` — same as Q.M4.ARITH.DISTRIBUTIVE.CHALLENGE.001
* `Q.M4.FRAC.EQUIVALENT.AI.001` — same as Q.M4.FRAC.EQUIVALENT.003

`VERSION_TAG`: nhãn khuôn mẫu như “[Phiên bản N]”, “(Mẫu 1)”, “(Tình huống 1-Thấp)” nằm trong đề; đã được lọc khi nạp thư viện (`childFacingPrompt`), file dữ liệu giữ nguyên.

## Lưu ý về nguồn gốc

Các câu đều ghi `origin: authored`, nhưng chúng được dựng từ khuôn mẫu: cùng một lõi bài được bọc bằng nhiều câu dẫn (“Giải bài toán sau:”, “Một bạn đưa ra kết luận…”, “[Phiên bản N]”). Việc có đánh dấu lại thành `ai_generated`/`template` hay không do anh quyết định — báo cáo này không đổi dữ liệu.

File giáo viên rà: `B1-01_review_sample.csv` — 2820 dòng (30/kỹ năng, ưu tiên câu máy chưa kiểm được). Cột cuối để giáo viên điền Y/N.
