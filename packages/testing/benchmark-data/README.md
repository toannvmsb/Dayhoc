# AI Parent Learning Copilot — AI/OCR Benchmark Kit v1.0

Bộ benchmark để chốt Vision/OCR/advanced LLM bằng dữ liệu thật thay vì giả định.

## Có sẵn
- 40 benchmark image slots.
- Ground-truth template + schema.
- 4 pipeline candidates.
- Weighted scoring + hard gates.
- Cost telemetry template.
- Final routing decision template.
- Claude implementation prompt.

## Chưa có chủ ý
**Ảnh vở/bài kiểm tra thật.** Vì dữ liệu trẻ em cần được kiểm soát, kit chỉ tạo manifest. Anh/dev bổ sung 30–50 ảnh thật đã ẩn PII vào thư mục `images/`, rồi tạo ground truth human-verified.

## Kết quả cuối benchmark phải trả lời
1. Luna có đủ tốt làm default Vision không?
2. Google OCR có cải thiện đáng kể handwriting/math không?
3. Terra hay Claude Sonnet tốt hơn cho advanced/HSG?
4. Confidence threshold nào kích hoạt fallback/escalation?
5. Cost/page và projected AI COGS theo từng gói là bao nhiêu?
6. Với chi phí đo được, pricing hiện tại còn giữ profit floor hay không?
