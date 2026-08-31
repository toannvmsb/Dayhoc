# CLAUDE CODE — AI/OCR BENCHMARK IMPLEMENTATION PROMPT

Mục tiêu: xây benchmark harness, KHÔNG tự chọn provider trước khi có kết quả ảnh thật.

1. Đọc:
- Pricing_AI_Cost_Guardrails_Model_Routing_v1.0.md
- BENCHMARK_PROTOCOL.md
- provider_candidates.yaml
- scoring_and_gates.yaml
- benchmark_cases.jsonl

2. Implement adapters cho P1–P4 nhưng credentials/config phải qua environment variables.
Không hard-code API key, live model version hoặc live pricing.

3. Tạo một output schema thống nhất cho cả 4 pipeline:
- transcription
- math expressions
- question/student-work segmentation
- existing skill_id candidates
- problem_type
- K/T
- answer/error localization
- confidence

4. Ground truth phải human_verified=true mới được đưa vào ranking.

5. Mọi run phải ghi cost telemetry. Live price table phải nằm trong config riêng và có effective_date.

6. Chạy benchmark trên cùng tập ảnh. Tính weighted score + hard gates.
Không xếp hạng chỉ theo OCR character accuracy.

7. Routing decision:
- default = cheapest pipeline passing standard-case gates;
- OCR fallback only if measured improvement justifies it;
- advanced = Terra vs Sonnet chosen by measured quality-adjusted cost;
- low confidence must escalate or request rescan, never silently commit.

8. Sau benchmark, điền FINAL_ROUTING_DECISION_TEMPLATE.json và tạo:
BENCHMARK_REPORT.md
COST_REPORT.md
ROUTING_RECOMMENDATION.md

9. Recalculate projected AI COGS by FREE/BASIC/PLUS/PRO using measured usage/cost.
Flag BLOCKER if a plan exceeds its AI hard ceiling or modeled profit floor.

10. Dừng sau report. Không tự sửa production routing/price/package until approved.
