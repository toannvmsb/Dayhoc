# AI Parent Learning Copilot
## Math Core Knowledge Base — Grade 4 v1.0

> **Purpose**: Core Markdown data/specification for Claude and the application backend.
>
> **Scope**: Toán lớp 4 — bộ sách **Kết nối tri thức với cuộc sống**, kết hợp:
> - SGK Toán 4 Tập 1
> - SGK Toán 4 Tập 2
> - Lộ trình Toán nâng cao lớp 4 36 tuần đã xây dựng trước đó
> - Bộ bài tập nâng cao lớp 4 đã dùng làm benchmark
>
> **Important design rule**: `school_grade` is context, not a ceiling. The engine must reason by **skill**, **prerequisite**, **problem type**, **mastery**, **thinking demand**, and **actual learning frontier**.

---

# 1. Product Learning Philosophy

The application is a **Parent Learning Copilot**, not a question bank and not a generic AI tutor.

```text
LEARNING CONTEXT
    ↓
CHILD LEARNING TWIN
    ↓
KNOWLEDGE GAP DETECTION
    ↓
LEARNING PRESCRIPTION
    ↓
ADAPTIVE PRACTICE & THINKING
    ↓
ASSESSMENT
    ↓
UPDATE TWIN
    ↓
NEXT BEST LEARNING ACTION
```

The system optimizes for three learning layers:

1. **HỌC CHẮC** — chắc kiến thức chuẩn, không hổng prerequisite.
2. **HỌC SÂU** — hiểu bản chất, vận dụng và kết nối kiến thức.
3. **HỌC CAO** — phát triển tư duy, HSG, challenge, competition readiness.

Core principle:

> **Nâng cách suy nghĩ trước khi nâng kiến thức.**

---

# 2. Core Data Model

```yaml
skill:
  id: string
  grade_context: 4
  domain: string
  topic: string
  name: string
  description: string
  curriculum_source:
    textbook: "Toán 4 - Kết nối tri thức"
    volume: 1|2
    lesson: string
  prerequisites: []
  child_mastery:
    score: 0-100
    confidence: 0-1
  problem_types: []
  thinking_dimensions: []
  advanced_extensions: []
  gap_rules: []
  next_skills: []
```

A student must never be represented by one overall label such as "khá" or "giỏi". Mastery is **skill-specific**.

---

# 3. Evidence Model

```yaml
evidence_sources:
  - school_test
  - school_exam
  - school_homework
  - app_worksheet
  - app_practice
  - diagnostic
  - parent_feedback
  - teacher_feedback
  - notebook_scan
  - teacher_message_scan
```

Suggested evidence confidence hierarchy:

```text
A. Verified: teacher/school confirmed content, marked test, exam
B. Strong: homework, worksheet, completed work, textbook-linked assignment
C. Supporting: notebook, teacher message, parent observation
D. Estimated: curriculum timing only
```

Parent feedback creates a **gap hypothesis**, not an automatic confirmed gap.

---

# 4. Grade 4 Standard Curriculum Backbone

## Volume 1

### Chủ đề 1 — Ôn tập và bổ sung
- Ôn tập các số đến 100 000
- Ôn tập các phép tính trong phạm vi 100 000
- Số chẵn, số lẻ
- Biểu thức chữ
- Giải bài toán có ba bước tính
- Luyện tập chung

### Chủ đề 2 — Góc và đơn vị đo góc
- Đo góc, đơn vị đo góc
- Góc nhọn, góc tù, góc bẹt
- Luyện tập chung

### Chủ đề 3 — Số có nhiều chữ số
- Số có sáu chữ số, số 1 000 000
- Hàng và lớp
- Các số trong phạm vi lớp triệu
- Làm tròn số đến hàng trăm nghìn
- So sánh các số có nhiều chữ số
- Làm quen với dãy số tự nhiên
- Luyện tập chung

### Chủ đề 4 — Một số đơn vị đo đại lượng
- Yến, tạ, tấn
- Đề-xi-mét vuông, mét vuông, mi-li-mét vuông
- Giây, thế kỉ
- Thực hành và trải nghiệm sử dụng một số đơn vị đo
- Luyện tập chung

### Chủ đề 5 — Phép cộng và phép trừ
- Phép cộng các số có nhiều chữ số
- Phép trừ các số có nhiều chữ số
- Tính chất giao hoán và kết hợp của phép cộng
- Tìm hai số biết tổng và hiệu của hai số đó
- Luyện tập chung

### Chủ đề 6 — Đường thẳng vuông góc. Đường thẳng song song
- Hai đường thẳng vuông góc
- Thực hành và trải nghiệm vẽ hai đường thẳng vuông góc
- Hai đường thẳng song song
- Thực hành và trải nghiệm vẽ hai đường thẳng song song
- Hình bình hành, hình thoi
- Luyện tập chung

### Chủ đề 7 — Ôn tập học kì I
- Ôn tập các số đến lớp triệu
- Ôn tập phép cộng, phép trừ
- Ôn tập hình học
- Ôn tập đo lường
- Ôn tập chung

## Volume 2

### Chủ đề 8 — Phép nhân và phép chia
- Nhân với số có một chữ số
- Chia cho số có một chữ số
- Tính chất giao hoán và kết hợp của phép nhân
- Nhân, chia với 10, 100, 1 000, ...
- Tính chất phân phối của phép nhân đối với phép cộng
- Nhân với số có hai chữ số
- Chia cho số có hai chữ số
- Thực hành và trải nghiệm ước lượng trong tính toán
- Tìm số trung bình cộng
- Bài toán liên quan đến rút về đơn vị
- Luyện tập chung

### Chủ đề 9 — Làm quen với yếu tố thống kê, xác suất
- Dãy số liệu thống kê
- Biểu đồ cột
- Số lần xuất hiện của một sự kiện
- Luyện tập chung

### Chủ đề 10 — Phân số
- Khái niệm phân số
- Phân số và phép chia số tự nhiên
- Tính chất cơ bản của phân số
- Rút gọn phân số
- Quy đồng mẫu số các phân số
- So sánh phân số
- Luyện tập chung

### Chủ đề 11 — Phép cộng, phép trừ phân số
- Phép cộng phân số
- Phép trừ phân số
- Luyện tập chung

### Chủ đề 12 — Phép nhân, phép chia phân số
- Phép nhân phân số
- Phép chia phân số
- Tìm phân số của một số
- Luyện tập chung

### Chủ đề 13 — Ôn tập cuối năm
- Ôn tập số tự nhiên
- Ôn tập phép tính với số tự nhiên
- Ôn tập phân số
- Ôn tập phép tính với phân số
- Ôn tập hình học và đo lường
- Ôn tập một số yếu tố thống kê và xác suất
- Ôn tập chung

---

# 5. Domain Taxonomy

```yaml
domains:
  - number_sense
  - arithmetic
  - algebraic_thinking
  - word_problems
  - fractions
  - geometry
  - measurement
  - statistics_probability
  - logical_reasoning
  - pattern_reasoning
  - combinatorial_thinking
```

---

# 6. Initial Skill Graph

## 6.1 Number Sense

```yaml
M4.NUM.001:
  name: Place value up to 100000
  next: [M4.NUM.010]

M4.NUM.010:
  name: Six-digit numbers and 1,000,000
  prerequisites: [M4.NUM.001]
  next: [M4.NUM.020, M4.NUM.030]

M4.NUM.020:
  name: Hàng và lớp
  prerequisites: [M4.NUM.010]

M4.NUM.030:
  name: Numbers in millions class
  prerequisites: [M4.NUM.020]

M4.NUM.040:
  name: Compare multi-digit numbers
  prerequisites: [M4.NUM.020]

M4.NUM.050:
  name: Round to hundred-thousands
  prerequisites: [M4.NUM.020, M4.NUM.040]

M4.NUM.060:
  name: Natural-number sequence
  advanced_extensions:
    - arithmetic_sequences
    - missing_terms
    - nth_term
    - sequence_sum
    - alternating_sequences

M4.NUM.070:
  name: Even and odd numbers
  advanced_extensions:
    - parity_reasoning
    - parity_of_sum
    - parity_patterns
```

## 6.2 Addition/Subtraction

```yaml
M4.ARITH.ADD_MULTI:
  name: Multi-digit addition

M4.ARITH.SUB_MULTI:
  name: Multi-digit subtraction

M4.ARITH.ADD_COMM:
  name: Commutative property of addition
  prerequisites: [M4.ARITH.ADD_MULTI]

M4.ARITH.ADD_ASSOC:
  name: Associative property of addition
  prerequisites: [M4.ARITH.ADD_MULTI]

M4.ARITH.ADD_FAST:
  name: Strategic fast addition
  prerequisites: [M4.ARITH.ADD_COMM, M4.ARITH.ADD_ASSOC]
  advanced_extensions:
    - make_round_numbers
    - compensation
    - pairing
    - cancellation
```

## 6.3 Multiplication/Division

```yaml
M4.ARITH.MUL_1DIGIT:
  name: Multiply by one-digit number

M4.ARITH.DIV_1DIGIT:
  name: Divide by one-digit number

M4.ARITH.MUL_COMM:
  name: Commutative property of multiplication

M4.ARITH.MUL_ASSOC:
  name: Associative property of multiplication

M4.ARITH.POW10:
  name: Multiply/divide by 10, 100, 1000...

M4.ARITH.DISTRIBUTIVE:
  name: Distributive property
  problem_types:
    - direct_expansion
    - calculate_two_ways
    - convenient_calculation
    - common_factor_recognition
    - hidden_common_factor
    - multi_term_factorization
  advanced_extensions:
    - factor_common_multiplier
    - cancellation
    - transform_before_calculating
    - equation_simplification

M4.ARITH.MUL_2DIGIT:
  name: Multiply by two-digit number

M4.ARITH.DIV_2DIGIT:
  name: Divide by two-digit number

M4.ARITH.ESTIMATE:
  name: Estimation in calculation

M4.ARITH.AVERAGE:
  name: Arithmetic mean
  advanced_extensions:
    - recover_total_from_average
    - missing_value_from_average
    - changed_average
    - adding_removing_data
```

---

# 7. Algebraic Thinking

```yaml
M4.ALG.EXPR_VAR:
  name: Biểu thức chữ
  skills:
    - understand_variable_as_placeholder
    - substitute_value
    - evaluate_expression
    - compare_expressions

M4.ALG.FIND_X:
  name: Tìm thành phần chưa biết / tìm x
  levels:
    basic:
      - inverse_operation
    intermediate:
      - two_step_equation
      - expression_simplification
    advanced:
      - x_appears_multiple_times
      - factor_x
      - simplify_both_sides
      - nested_operations
    challenge:
      - construct_equation
      - solve_by_structure
```

Prerequisite chain:

```text
Arithmetic fluency
→ inverse operations
→ expression recognition
→ distributive property
→ simplify expression
→ find x
```

---

# 8. Word Problem Graph

```yaml
M4.WORD.3STEP:
  thinking:
    - identify_given_information
    - determine_goal
    - decompose_into_subgoals
    - choose_operations
    - explain_solution_sequence

M4.WORD.SUM_DIFF:
  name: Find two numbers from sum and difference
  problem_types:
    - direct_sum_difference
    - hidden_sum
    - hidden_difference
    - after_transfer
    - before_after_change

M4.WORD.UNIT_RATE:
  name: Rút về đơn vị
  problem_types:
    - find_one_then_many
    - find_many_then_one
    - inverse_unit_rate
    - multi_step_unit_rate
```

Advanced extensions from the prior roadmap:

```yaml
advanced_word_problem_families:
  - sum_difference_hidden
  - sum_ratio
  - difference_ratio
  - age_problems
  - time_problems
  - reverse_operation_problems
  - multiple_solution_methods
```

---

# 9. Fractions Skill Graph

```text
Fraction concept
    ↓
Fraction as division
    ↓
Equivalent fractions
    ↓
Simplification
    ↓
Common denominator
    ↓
Comparison
    ↓
Addition/Subtraction
    ↓
Multiplication
    ↓
Division
    ↓
Fraction of a quantity
```

```yaml
skills:
  - M4.FRAC.CONCEPT
  - M4.FRAC.AS_DIVISION
  - M4.FRAC.EQUIVALENT
  - M4.FRAC.SIMPLIFY
  - M4.FRAC.COMMON_DENOM
  - M4.FRAC.COMPARE
  - M4.FRAC.ADD
  - M4.FRAC.SUB
  - M4.FRAC.MUL
  - M4.FRAC.DIV
  - M4.FRAC.OF_QUANTITY
```

Gap diagnosis must follow prerequisite chains rather than labeling the visible failed operation immediately.

---

# 10. Geometry Skill Graph

```yaml
M4.GEO.ANGLE_MEASURE:
  name: Measure angles and degree unit

M4.GEO.ANGLE_TYPE:
  name: Acute, obtuse, straight angles
  prerequisites: [M4.GEO.ANGLE_MEASURE]

M4.GEO.PERPENDICULAR:
  name: Perpendicular lines

M4.GEO.PARALLEL:
  name: Parallel lines

M4.GEO.PARALLELOGRAM:
  name: Parallelogram

M4.GEO.RHOMBUS:
  name: Rhombus
```

Advanced extensions:

```yaml
geometry_extensions:
  - recognize_hidden_angles
  - count_shapes
  - construct_shapes
  - compare_multiple_figures
  - infer_missing_measure
  - spatial_reasoning
  - systematic_counting
```

---

# 11. Measurement

```yaml
M4.MEAS.MASS:
  topics: [yen, ta, tan]

M4.MEAS.AREA:
  topics: [dm2, m2, mm2]

M4.MEAS.TIME:
  topics: [second, century]

M4.MEAS.CONVERSION:
  advanced_extensions:
    - multi_unit_conversion
    - hidden_conversion
    - word_problem_conversion
    - time_interval_reasoning
```

---

# 12. Statistics & Probability

```yaml
M4.STAT.DATA_SEQUENCE:
  name: Data sequences

M4.STAT.BAR_CHART:
  name: Bar charts

M4.PROB.EVENT_FREQUENCY:
  name: Number of occurrences of an event
```

Thinking extensions:

```yaml
statistics_thinking:
  - read_data
  - compare_data
  - infer_from_chart
  - missing_value
  - total_average_connection
  - simple_experimental_probability_intuition
```

---

# 13. Advanced Math Layer — Grade 4

The previous 36-week roadmap is an **Advanced/Thinking reference**, not the primary runtime structure.

```yaml
advanced_families:
  - fast_calculation_add_sub
  - fast_calculation_mul_div
  - distributive_factorization
  - mixed_fast_calculation
  - advanced_find_x
  - multi_step_find_x
  - arithmetic_sequences
  - advanced_sequences
  - number_construction
  - digit_problems
  - divisibility
  - division_with_remainder
  - average
  - advanced_average
  - sum_difference
  - advanced_sum_difference
  - sum_ratio
  - difference_ratio
  - age_problems
  - advanced_age_problems
  - units_conversion
  - time_problems
  - logical_reasoning
  - systematic_counting
  - reverse_calculation
  - multiple_methods
  - mixed_HSG
  - final_challenge
```

Principle:

> **Bám kiến thức Toán lớp 4, tăng độ khó bằng tư duy và biến đổi, không chỉ chạy trước chương trình.**

---

# 14. Problem Type Graph

Example for distributive property:

```yaml
skill: M4.ARITH.DISTRIBUTIVE
problem_types:
  P1: {name: direct_use, thinking: low}
  P2: {name: recognize_common_factor, thinking: medium}
  P3: {name: convenient_calculation, thinking: medium}
  P4: {name: hidden_common_factor, thinking: high}
  P5: {name: three_or_more_terms, thinking: high}
  P6: {name: equation_with_common_factor, thinking: high}
  P7: {name: create_own_expression, thinking: very_high}
```

Track **problem type mastery separately from skill mastery**.

---

# 15. Two Independent Difficulty Axes

## Knowledge Level

```yaml
K0: prerequisite_gap
K1: concept_intro
K2: textbook_standard
K3: strong_school
K4: advanced_HSG
K5: competition_extension
```

## Thinking Level

```yaml
T1: recall_execute
T2: recognize_apply
T3: transform_combine
T4: reason_strategically
T5: non_routine_challenge
```

A problem may use only Grade 4 knowledge but have Thinking Level T5.

---

# 16. Adaptive Practice Ladder

```text
A. Củng cố
B. Biến đổi
C. Vận dụng
D. Kết hợp
E. Tư duy
F. Challenge / HSG
```

Suggested default mix:

```yaml
basic_and_core: 0.45
variation_application: 0.30
thinking_advanced: 0.25
```

Dynamically adapt using mastery, gaps, goals, exams, available time, readiness, and recent errors.

---

# 17. Stretch Zone Rule

```yaml
stretch_zone:
  solvable_with_current_mastery: 0.70-0.80
  productive_struggle: 0.20-0.30
```

If the student fails:

```text
Hint 1
→ Guiding question
→ Hint 2
→ Simpler analogous problem
→ Retry original
→ Full solution only if necessary
```

---

# 18. Thinking Dimensions

```yaml
thinking_dimensions:
  - number_sense
  - logical_reasoning
  - pattern_recognition
  - problem_representation
  - strategic_choice
  - algebraic_thinking
  - spatial_reasoning
  - proof_explanation
  - combinatorial_thinking
  - reverse_reasoning
```

---

# 19. Knowledge Gap Model

```yaml
gap_types:
  - concept_gap
  - prerequisite_gap
  - method_gap
  - recognition_gap
  - application_gap
  - reasoning_gap
  - procedural_gap
  - retention_gap
  - careless_error
  - reading_error
  - presentation_error
```

Only appropriate gap types should trigger remediation. A careless error should not heavily reduce knowledge mastery automatically.

---

# 20. Root Gap Diagnosis

Example:

```text
Student fails: 37 × 28 + 37 × 72

Possible causes:
A. multiplication weak
B. distributive property unknown
C. common-factor structure not recognized
D. knows method but arithmetic error
```

Diagnostic sequence:

```text
Observed error
→ identify target skill
→ trace prerequisites
→ inspect error steps
→ ask short diagnostic items
→ classify gap
→ determine root gap
```

---

# 21. Gap Score

Conceptual model:

```text
gap_score =
  target_mastery_difference
  × evidence_confidence
  × recurrence_factor
  × prerequisite_importance
  × future_dependency
  × learning_goal_weight
```

A smaller gap can have higher priority if it blocks upcoming learning.

---

# 22. Gap Lifecycle

```text
DETECTED
→ CONFIRMED
→ TREATING
→ IMPROVING
→ CLOSED
→ MONITORING
```

Closing criteria require remediation, re-test, and delayed retention check.

---

# 23. Learning Prescription

```yaml
learning_prescription:
  gap: "Common denominator of fractions"
  severity: medium
  root_gap: "Equivalent fractions"
  duration_days: 7
  sessions: 3
  minutes_per_session: 15
  exercises:
    foundation: 6
    standard: 5
    application: 3
    thinking: 2
  retest_items: 5
  retention_check_days: 7
```

Parent Copilot explains what is missing, why it matters, how much practice is recommended, and whether it blocks current/advanced learning.

---

# 24. Learning Mix

```yaml
learning_mix_dimensions:
  - current_school_learning
  - gap_repair
  - advanced_practice
  - thinking_development
  - exam_revision
```

Examples:

```yaml
normal_week: {school: 40, gap_repair: 20, advanced: 25, thinking: 15}
after_gap_test: {school: 25, gap_repair: 50, advanced: 15, thinking: 10}
strong_student: {school: 20, gap_repair: 10, advanced: 40, thinking: 30}
```

---

# 25. Learning Readiness

```text
Learning Readiness
=
prerequisite mastery
+ relevant problem-type mastery
+ thinking readiness
+ retention confidence
```

If readiness is low, either repair prerequisite first or continue with parallel gap repair.

---

# 26. Actual Learning Frontier

```yaml
school_grade: 4
standard_curriculum_position: ...
actual_taught_position: ...
actual_learning_frontier: ...
```

Never output a single global grade level as if it describes all math ability.

---

# 27. Daily Plan Logic

Inputs:

```text
actual learning context
+ child twin
+ gap priorities
+ parent goal
+ available time
+ exam proximity
+ readiness
```

Output example:

```yaml
daily_plan:
  available_minutes: 25
  current_school: 8
  gap_repair: 7
  advanced: 5
  thinking: 5
```

Optimize **Highest Learning ROI / Available Minute**.

---

# 28. Exam / Revision Mode

```text
Recent Actual Learning Context
+ Exam Scope
+ Child Twin
+ Gap History
+ Forgetting / retention
→ Revision Map
→ Personalized Revision Plan
```

Revision priority:

```text
probability_in_exam
× knowledge_gap
× forgetting
× importance
× prerequisite_impact
```

---

# 29. Assessment Model

```text
scan/read solution
→ segment questions
→ map question to skill/problem type
→ evaluate correctness
→ inspect reasoning/process
→ classify errors
→ update evidence
→ update mastery/gaps
```

Do not treat every lost point as the same weakness.

---

# 30. Parent Copilot Outputs

```text
Con đang học gì?
Con đang tốt/yếu chỗ nào?
Gap nào cần xử lý trước?
Cần bổ sung bao nhiêu?
Hôm nay bố/mẹ cần dành bao nhiêu phút?
Nên hướng dẫn thế nào?
Có nên tăng độ khó chưa?
```

---

# 31. Child UI Rule

Allowed:
- Hôm nay
- Bài tập
- Ôn tập
- Thử thách
- Hint
- Kết quả trực tiếp phù hợp

Do not show:
- gap score
- parent decision dashboard
- competitive ranking by default
- complex mastery charts

Child focus:

> **What do I need to do now?**

---

# 32. Teacher Role — MVP

Teacher is an **optional contributor**.

MVP teacher functions:
- mark what was taught today,
- indicate lesson/topic,
- indicate common exercise types,
- add homework,
- add upcoming test scope/date.

Product remains fully useful without teacher participation.

---

# 33. Advanced Dataset Examples

## Distributive / Factorization

```text
237 × 46 + 237 × 54
425 × 157 - 425 × 57
257 × 432 + 257 × 354 + 257 × 214
2026 × 99 + 2026
```

Map to distributive property, common-factor recognition, transform-before-calculate, strategic calculation.

## Advanced Find x

```text
37 × x + 63 × x - 500 = 4500
x × 48 + x × 52 = 7500
2026 × x - 2025 × x = 2026
```

Map to common factor, simplification before solving, algebraic thinking.

## Counting / Combinatorial Thinking
- count squares in a grid,
- count line segments from points,
- clothing combinations,
- route combinations,
- form numbers from digits.

## Reverse Calculation
- reverse multi-step operations,
- infer original number,
- create an operation chain and solve backwards.

---

# 34. Mastery Progression Rule — Initial

```yaml
progression:
  high:
    accuracy: ">=85%"
    explanation_quality: adequate
    action: increase_difficulty
  medium:
    accuracy: "65-84%"
    action: practice_same_family
    additional_items: "3-5"
  low:
    accuracy: "<65%"
    action: return_to_example_and_prerequisite
```

Do not use accuracy alone. Include hint dependency, speed, reasoning quality, retention, and error recurrence.

---

# 35. Daily Thinking Challenge

Requirements:
- 5–15 minutes,
- non-routine,
- prerequisite-ready,
- explanation encouraged,
- final answer is not the only assessment target.

Ask after completion:

> **Con đã nghĩ theo cách nào?**

---

# 36. Core Engine Interfaces

```text
curriculum_service
skill_graph_service
prerequisite_service
evidence_service
mastery_service
gap_service
readiness_service
practice_service
assessment_service
planning_service
revision_service
parent_copilot_service
```

---

# 37. Recommended Claude Data Layout

```text
/core/math/
  /grade4/
    README.md
    curriculum.md
    skill_graph.yaml
    prerequisite_graph.yaml
    problem_types.yaml
    thinking_taxonomy.yaml
    advanced_extensions.yaml
    gap_rules.yaml
    mastery_rules.yaml
    golden_cases.yaml
```

This file can initially serve as `README.md` and later be split into runtime YAML/JSON.

---

# 38. Golden Test Scenarios — Grade 4

## G4-01 Standard student
Follows textbook pace; average mastery; occasional arithmetic errors.

## G4-02 Strong arithmetic, weak word problems
Reduce repetitive arithmetic; diagnose representation/reading/decomposition.

## G4-03 Good knowledge, careless errors
Do not over-diagnose knowledge gaps; keep advanced path.

## G4-04 Advanced student
Skip excessive basic repetition; use variation/application/thinking/HSG.

## G4-05 Parent reports weakness not confirmed
Create hypothesis; run diagnostic; do not automatically penalize mastery.

## G4-06 Test reveals prerequisite root gap
Trace backwards; issue targeted prescription; preserve unrelated strengths.

## G4-07 Upcoming exam
Enter revision mode; prioritize recent taught content and active gaps.

## G4-08 Mixed-level profile
Example: Arithmetic advanced, Fractions standard, Geometry weak, Logic advanced.

Expected: no single global level; skill-specific daily mix.

---

# 39. Non-Negotiable Rules for Claude

1. Do not generate practice by grade alone.
2. Do not infer global ability from one test.
3. Do not classify every wrong answer as a knowledge gap.
4. Do not close a gap after one correct answer.
5. Do not equate advanced learning with higher-grade content.
6. Do not show complex parent analytics on child screen.
7. Do not make teacher participation mandatory in MVP.
8. Do not let the LLM own deterministic prerequisite/curriculum rules.
9. Do not overwrite evidence history; keep auditable observations.
10. Always select the next task from child state + context + prerequisites + goals.

---

# 40. Definition of Next Best Learning Action

```text
Next Best Learning Action
=
best action that maximizes expected learning progress
within available time
while respecting prerequisites,
current school context,
active knowledge gaps,
child readiness,
parent goal,
and exam constraints.
```

Possible actions:
- review prerequisite,
- practice current skill,
- close active gap,
- move to harder problem type,
- thinking challenge,
- advanced extension,
- exam revision,
- retention check,
- no extra practice needed.

---

# 41. Source / Provenance Notes

## Source-derived
The Grade 4 standard curriculum structure and lesson sequence are derived from:
- **SGK Toán 4 Kết nối tri thức — Tập 1**
- **SGK Toán 4 Kết nối tri thức — Tập 2**

The advanced topic families and progression approach are derived from the previously created:
- **Lộ trình Toán nâng cao lớp 4 — 36 tuần**
- **Bài tập Toán nâng cao lớp 4 — Bản học sinh**

## Product-model-derived
The following are application design constructs, not textbook terminology:
- Child Learning Twin
- Actual Learning Frontier
- Knowledge Gap lifecycle
- Learning Prescription
- Learning Mix
- Learning Readiness
- Problem Type Mastery
- Knowledge Level / Thinking Level
- Next Best Learning Action

These concepts must remain configurable and be validated against real student evidence.

---

# 42. Version Status

```yaml
version: 1.0
status: "Grade 4 core foundation — initial"
ready_for:
  - technical implementation
  - curriculum normalization
  - skill graph extraction
  - golden dataset creation
not_yet_complete:
  - full item-level textbook mapping
  - full prerequisite validation by math educator
  - calibrated mastery coefficients
  - calibrated gap score coefficients
  - Grade 7 integration
```

---

# 43. Next Build Step

```text
1. Normalize every SGK Grade 4 lesson → skills
2. Assign stable Skill IDs
3. Build prerequisite DAG
4. Build problem-type graph
5. Map advanced 36-week content into extensions
6. Build 100–200 initial golden questions
7. Build 8–12 golden student profiles
8. Implement deterministic mastery/gap engine
9. Add LLM classification/generation layer
10. Run golden tests before UI expansion
```

---

# Final Product Rule

> **The app should never ask only “Con học lớp mấy?” to decide what the child should learn.**
>
> It must answer:
>
> **Con đang học gì? Con đã thực sự biết gì? Con đang thiếu gì? Con đã sẵn sàng học gì tiếp theo? Và với thời gian hiện có, bước học nào mang lại giá trị lớn nhất?**
