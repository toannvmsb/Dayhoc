# AI/OCR Benchmark Protocol v1.0

## Mục tiêu
Không chọn OCR/Vision/LLM theo cảm tính. Đo trực tiếp trên ảnh bài học thật của Grade 4 và Grade 7 để quyết định:
1. Default scan pipeline.
2. Khi nào cần OCR riêng.
3. Khi nào Luna phải escalate.
4. Advanced route nên dùng Terra hay Claude Sonnet.
5. Cost/page và cost/active child thực tế.

## Dataset
Kit có 40 slot ảnh thật:
- Grade 4: đề in, chữ viết tay, phân số, hình học.
- Grade 7: số hữu tỉ, phương trình, hình học/chứng minh, nâng cao/HSG.
- Ảnh chất lượng xấu.

**Kit không chứa ảnh học sinh thật.** Dev phải bổ sung 30–50 ảnh thật đã được ẩn PII. Không gửi tên trẻ, tên trường, lớp cụ thể, địa chỉ hoặc dữ liệu không cần thiết cho provider.

## Quy trình chuẩn
### Phase A — Chuẩn bị ground truth
Hai người review độc lập nếu có thể:
- transcription;
- biểu thức toán;
- ranh giới đề bài/bài làm;
- đáp án học sinh;
- vị trí lỗi;
- skill_id/problem_type từ catalog hiện có;
- K/T;
- chất lượng ảnh.

Ground truth phải human-verified trước khi dùng để xếp hạng provider.

### Phase B — Chạy 4 pipeline
P1 Luna Vision.
P2 Luna + Google Document AI OCR.
P3 Terra Vision.
P4 Claude Sonnet Vision.

Mỗi case chạy cùng một structured output contract. Temperature/config phải được giữ nhất quán tối đa có thể.

### Phase C — Đo
Bắt buộc log:
provider, model_version, operation_type, input/output tokens, OCR pages, latency, retry count,
estimated_cost_usd, estimated_cost_vnd, confidence, schema_pass, escalation_reason.

### Phase D — Chọn routing
Không chọn “model tốt nhất tuyệt đối”.
Chọn **pipeline rẻ nhất đạt quality gate**.

Ví dụ:
- Luna đạt gate ở ảnh chuẩn → Luna default.
- Luna fail chữ viết tay nhưng Luna+OCR pass → OCR fallback cho handwriting/low-confidence.
- Luna/Luna+OCR fail HSG → benchmark Terra vs Sonnet và chọn pipeline có quality-adjusted cost tốt hơn.

## Cost metrics
- VND / scanned page
- VND / successful extraction
- VND / diagnosis
- VND / active child / month
- escalation rate
- retry rate
- OCR fallback rate
- advanced-model rate

## Không được làm
- Không dùng accuracy OCR chữ thường làm tiêu chí duy nhất.
- Không để model tự tạo production skill_id.
- Không commit low-confidence mapping vào Twin mà không qua policy.
- Không dùng ảnh chứa PII chưa được anonymize.
- Không sửa ground truth để làm provider pass.
