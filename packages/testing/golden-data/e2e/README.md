# Golden End-to-End Family Journey Dataset v1.0

## Mục tiêu
Kiểm thử toàn bộ MVP như một gia đình thật dùng app trong 30–90 ngày:

Onboarding → Child Profile → Learning Context → Scan/Upload → AI Extraction/Mapping → Evidence → Learning Twin → Gap Diagnosis → Parent Teaching Copilot → Child Practice/Hints → Retest/Retention → Daily/Weekly Planner → Exam Revision/Post-exam → Next Cycle.

## Quy mô
- 24 family journeys: 12 archetype × Grade 4/Grade 7
- thời lượng 30 / 45 / 60 / 90 ngày
- 15 failure & recovery scenarios
- expected checkpoints ở scan đầu, tuần đầu, diagnosis, retest và cuối hành trình

## E2E layers phải test
1. UI/role routing
2. API contracts & authorization
3. upload/storage privacy
4. AI extraction/mapping schema
5. deterministic evidence/twin/gap rules
6. planner/readiness
7. Parent Copilot
8. ChildTaskViewModel
9. exam/revision
10. retention & final-cycle recommendation

## Invariant đặc biệt
Child client **không được nhận** parent analytics rồi chỉ ẩn bằng UI. Parent-only fields phải vắng mặt từ API projection.

## Provenance
Bộ này kế thừa expected Twin/Planner state từ Golden Learning Twin & Planner Dataset v1.0 và mở rộng thành synthetic E2E journeys. Không phải dữ liệu người dùng thật.
