# 07 — Math Engine Plan

> **⚠ Một phần bị SUPERSEDED bởi Architecture Migration v1.1 (AI-Generation-First — chờ anh duyệt).** Xung đột + luật mới: `docs/implementation/12`–`17`. Doc này sẽ được cập nhật khi migration được APPROVE.

> Authority: Math Core Grade 4 (§14–§40) + Grade 7 + Tech Spec §8–§9. **Deterministic-first.** Engine là pure functions trên evidence + rules → dễ golden-test.

---

## 1. Thành phần & tính chất

| Thành phần | Deterministic | AI-assisted |
|---|---|---|
| Curriculum Graph | ✅ | — |
| Skill Graph | ✅ | (candidate mapping) |
| Cross-grade Prerequisite DAG | ✅ | — |
| Problem Type Graph | ✅ | (candidate mapping) |
| Knowledge Level K0–K5 | ✅ (gán cho item) | (đề xuất khi phân loại) |
| Thinking Level T1–T5 | ✅ (gán cho item) | (đề xuất khi phân loại) |
| Evidence model | ✅ (append-only) | (sinh evidence từ scan) |
| Mastery calculation | ✅ | — |
| Gap detection | ✅ | (đề xuất error_class) |
| Root gap diagnosis | ✅ (trace prereq) | (gợi ý diagnostic item) |
| Gap priority (gap score) | ✅ | — |
| Gap lifecycle | ✅ | — |
| Readiness | ✅ | — |
| Learning Prescription | ✅ | (diễn giải parent-friendly) |
| Learning Mix | ✅ | — |
| Next Best Learning Action | ✅ | — |

---

## 2. Graphs

- **Curriculum Graph:** cây `CurriculumNode` theo SGK (grade4/grade7), versioned.
- **Skill Graph:** node = Skill (ID toàn cục ổn định). Cần **thống nhất ID scheme** giữa `M4.*` và `G7.*` (xem Risk R1).
- **Prerequisite DAG:** cạnh có hướng + `importance` + `cross_grade`. Validate **acyclic** ở CI.
- **Problem Type Graph:** mỗi skill có P1..Pn, mỗi P gắn (K-level, T-level). Ví dụ `M4.ARITH.DISTRIBUTIVE`: P1 direct_use(low) … P7 create_own_expression(very_high).

## 3. Hai trục độ khó độc lập

```
Knowledge Level: K0 prerequisite_gap · K1 concept · K2 standard · K3 strong · K4 advanced/HSG · K5 competition
Thinking Level : T1 recall/execute · T2 recognize/apply · T3 transform/combine · T4 strategic · T5 non-routine
```
Bất biến: **một bài K2 (kiến thức chuẩn lớp 4) vẫn có thể là T5.** Lưu `knowledge_level` và `thinking_level` **riêng**, cùng `curriculum_origin` (vd G9_HSG) tách khỏi `school_grade`.

## 4. Evidence model

- Append-only; mỗi evidence gắn skill/problem-type, result, reasoning_quality, hint_dependency, confidence_tier (A/B/C/D), provenance.
- Parent/teacher feedback → **hypothesis**, không confirmed.

## 5. Mastery calculation (deterministic)

**Không dùng accuracy đơn thuần.** Tổ hợp tín hiệu:
```
mastery(skill) = f(
   correctness,
   hint_dependency,        // càng phụ thuộc hint càng giảm
   reasoning_quality,
   retention,              // giữ được sau delay
   error_recurrence,       // lỗi lặp lại
   evidence_confidence     // A>B>C>D
)
```
- Careless error có **penalty thấp hơn** concept/prerequisite gap (không tự hạ mastery mạnh).
- Mastery **recomputable** từ toàn bộ evidence (idempotent). Coefficients để trong config (chưa calibrate — xem Risk).

## 6. Gap detection & root gap diagnosis

**Gap types:** concept, prerequisite, method, recognition, application, reasoning, procedural, retention, careless_error, reading_error, presentation_error.

**Diagnostic sequence (Math Core §20):**
```
Observed error → identify target skill → trace prerequisites → inspect error steps
→ (short diagnostic items) → classify gap → determine ROOT gap
```
Ví dụ `37×28 + 37×72` sai: phân biệt (a) nhân yếu, (b) chưa biết distributive, (c) không nhận cấu trúc common-factor, (d) đúng phương pháp nhưng sai số học. **Không** gán ngay "yếu phép nhân".

Grade 7 root-gap ladder: arithmetic → sign/order → distributive → rational manipulation → ratio/proportion → factorization/identity → structural recognition → proof strategy. **Không** suy "yếu đại số" từ một bài HSG.

## 7. Gap priority (gap score)

```
gap_score = target_mastery_difference
          × evidence_confidence
          × recurrence_factor
          × prerequisite_importance
          × future_dependency
          × learning_goal_weight
```
Một gap nhỏ có thể ưu tiên cao nếu **chặn** nội dung sắp học.

## 8. Gap lifecycle

```
DETECTED → CONFIRMED → TREATING → IMPROVING → CLOSED → MONITORING
```
Đóng gap cần: remediation + re-test + delayed retention check. **Không đóng sau một lần đúng.** Mọi chuyển trạng thái ghi `gap_lifecycle_events` (audit).

## 9. Readiness (deterministic)

```
Readiness(target_skill) = g(
   prerequisite_mastery,
   relevant_problem_type_mastery,
   thinking_readiness,
   retention_confidence
)
```
Readiness thấp → repair prerequisite trước, HOẶC **parallel gap repair** giữ đường advanced nếu an toàn (Grade 7 rule: không tự dừng advanced learning).

## 10. Learning Prescription

Output: gap, severity, root_gap, duration_days, sessions, minutes_per_session, dose {foundation, standard, application, thinking}, retest_items, retention_check_days. Kèm giải thích: thiếu gì, vì sao quan trọng, có chặn học hiện tại/nâng cao không.

## 11. Learning Mix (context-dependent)

| Tình huống | school | gap_repair | advanced | thinking/revision |
|---|---|---|---|---|
| Tuần bình thường | 40 | 20 | 25 | 15 |
| Vừa phát hiện gap lớn | 25 | 50 | 15 | 10 |
| Học sinh rất chắc | 20 | 10 | 40 | 30 |
| Sắp thi | theo scope | ưu tiên gap liên quan | giảm nếu không liên quan | revision là chính |

> Adaptive Practice Ladder (A củng cố → F challenge/HSG) với default mix gợi ý basic 0.45 / variation 0.30 / thinking 0.25 là **trục khác** với Learning Mix; hai bảng số không mâu thuẫn (xem `11_RISKS` note N1).

## 12. Next Best Learning Action

```
NBLA = action tối đa hóa expected learning progress
       trong available time,
       tôn trọng prerequisites, school context, active gaps,
       readiness, parent goal, exam constraints.
```
Action set: review prerequisite · practice current skill · close active gap · move to harder problem type · thinking challenge · advanced extension · exam revision · retention check · **no extra practice needed**.
Tối ưu: **Highest Learning ROI / Available Minute.**

## 13. Stretch zone & hint ladder

- Stretch: ~70–80% giải được bằng mastery hiện tại, ~20–30% productive struggle.
- Hint ladder khi fail: Hint 1 → guiding question → Hint 2 → simpler analogous → retry original → full solution nếu cần.

## 14. Exam / Revision

```
Recent Actual Context + Exam Scope + Twin + Gap History + forgetting
→ Revision Map → Personalized Revision Plan
revision_priority = probability_in_exam × knowledge_gap × forgetting × importance × prerequisite_impact
```
Nếu chưa có scope chính thức → suy từ recent context, parent confirm.

## 15. Data layout (Math Core §37) — `/packages/math-data`

```
/math/grade4/  README curriculum.md skill_graph.yaml prerequisite_graph.yaml
              problem_types.yaml thinking_taxonomy.yaml advanced_extensions.yaml
              gap_rules.yaml mastery_rules.yaml golden_cases.yaml
/math/grade7/  (tương tự)
/math/shared/  knowledge_thinking_taxonomy.yaml  gap_types.yaml
```

## 16. 10 luật bất khả xâm phạm (Math Core §39)

1. Không sinh bài theo grade đơn thuần. 2. Không suy global ability từ một bài test. 3. Không coi mọi câu sai là knowledge gap. 4. Không đóng gap sau một lần đúng. 5. Không đánh đồng advanced = grade cao hơn. 6. Không hiện parent analytics ở màn child. 7. Không bắt buộc teacher tham gia. 8. Không cho LLM sở hữu prerequisite/curriculum rules. 9. Không ghi đè evidence history. 10. Luôn chọn task từ child state + context + prerequisites + goals.
