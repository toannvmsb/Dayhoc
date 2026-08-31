# AI Parent Learning Copilot — Golden Learning Twin & Planner Dataset v1.0

## Mục tiêu
Kiểm thử câu hỏi cốt lõi: **Hôm nay con nên học gì?**

Pipeline: `Evidence → Learning Twin → Gap → Readiness → Learning Mix → Next Best Learning Action → Daily Plan`.

## Quy mô
- 48 hồ sơ giả lập: 24 Grade 4 + 24 Grade 7
- 912 learning evidence events
- 48 expected Twin/Planner states
- 15 curated planner scenarios
- Lịch sử 2–8 tuần; time budget 10/20/30/45 phút.

## 12 archetype
standard_progress, strong_advanced, prerequisite_gap, careless_profile, retention_decay, exam_mode, parent_hypothesis, conflicting_evidence, hint_dependence, parallel_gap_repair, thinking_gap, uneven_frontier.

## Invariants
- school_grade là context, không phải ceiling;
- frontier theo skill/domain;
- evidence append-only;
- mastery là projection rebuild được;
- parent feedback chỉ tạo hypothesis nếu chưa corroborate;
- careless penalty nhẹ;
- hinted success != independent success;
- T4/T5 fail có thể là thinking gap;
- Parallel Gap Repair được phép;
- Daily Plan không vượt time budget;
- Planner tối ưu Highest Learning ROI / Available Minute.

Dataset là synthetic golden fixture phục vụ automated testing, không phải dữ liệu học sinh thật.
