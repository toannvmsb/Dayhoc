# 08 — Golden Test Plan

> Golden educational tests là **bắt buộc trước khi mở rộng UI** (Tech Spec §14). Engine phải chứng minh khả năng **phân biệt các loại lỗi** và **tách Knowledge Level khỏi Thinking Level** — deterministic, trong tolerance.

---

## 1. Hai năng lực phân biệt bắt buộc

### 1.1 Phân biệt loại gap (8 loại cốt lõi)
Engine phải phân biệt: **knowledge gap · prerequisite gap · careless error · method gap · recognition gap · application gap · reasoning gap · retention gap.**

### 1.2 Tách Knowledge Level khỏi Thinking Level
Một bài Grade 4 dùng kiến thức K2 nhưng yêu cầu T5 → engine không được coi "khó = lớp cao hơn". Golden phải có case K2/T5 và K4/T2 để chứng minh hai trục độc lập.

---

## 2. Golden test registry (RECONCILED)

> ⚠️ Ba nguồn đặt tên khác nhau: Math Core Grade4 (`G4-01..08`), Grade7 (`G7-01..10`), Tech Spec (`G4-ADV, G4-EXAM, G7-CROSS, …`). Đây là **inconsistency đặt tên, không phải nội dung** (xem `11_RISKS` R2). Bảng dưới hợp nhất thành một registry duy nhất; ID cũ giữ làm alias.

### Grade 4
| Golden ID | Alias | Kịch bản | Kỳ vọng (discrimination) |
|---|---|---|---|
| GT-G4-01 | G4-01 | Standard student | Theo pace SGK; mastery trung bình; lỗi số học thỉnh thoảng → không over-diagnose |
| GT-G4-02 | G4-02, G4-ADV | Giỏi số học, yếu word problems | Giảm lặp số học; diagnose representation/reading/decomposition gap |
| GT-G4-03 | G4-03, CARELESS | Kiến thức tốt, lỗi bất cẩn | **careless_error** → không hạ mastery mạnh; giữ đường advanced |
| GT-G4-04 | G4-04 | Học sinh advanced | Bỏ lặp cơ bản; dùng variation/application/thinking/HSG |
| GT-G4-05 | G4-05, PARENT-HYP | Parent báo yếu, evidence chưa đủ | Tạo hypothesis + diagnostic; **không** tự penalize mastery |
| GT-G4-06 | G4-06 | Test lộ prerequisite root gap | Trace ngược; prescription đúng root; giữ strengths khác |
| GT-G4-07 | G4-07, G4-EXAM | Sắp thi | Revision mode; ưu tiên recent taught + active gaps đúng scope |
| GT-G4-08 | G4-08 | Mixed-level profile | Arithmetic advanced/Fractions standard/Geometry weak/Logic advanced → **không** global level; mix theo skill |

### Grade 7 (cross-grade)
| Golden ID | Alias | Kịch bản | Kỳ vọng |
|---|---|---|---|
| GT-G7-01 | G7-01, G7-15AUG(part) | 13/8 mixed review | Map rational arithmetic, equation levels, %, geometry, combinatorial counting **riêng biệt** |
| GT-G7-02 | G7-02, G7-15AUG | 15/8 ratio chain | Nhận progression direct → multi-variable constraints |
| GT-G7-03 | G7-03 | Ratio + xyz | Map ratio substitution + product constraint; không gán "simple proportion" |
| GT-G7-04 | G7-04 | Ratio + quadratic condition | Phân loại K4/T4+; check algebraic readiness |
| GT-G7-05 | G7-05, G7-IDENTITY(part) | Identity từ a+b, ab | Symmetric transformation; trace identities |
| GT-G7-06 | G7-06 | x + 1/x higher powers | Nhận recurrence/identity; tránh brute-force |
| GT-G7-07 | G7-07 | Factorization | Phân loại common factor/grouping/identity/symmetric |
| GT-G7-08 | G7-08, G7-CROSS | HSG Grade 9 source | `school_grade` vẫn 7; `curriculum_origin=G9_HSG`; readiness/prereq quyết định |
| GT-G7-09 | G7-09 | Fail do prerequisite | Diagnose root prerequisite + prescription |
| GT-G7-10 | G7-10, G7-IDENTITY | Fail do thinking | Knowledge mastery vẫn mạnh; hạ problem-type/thinking, **không** over-penalize core |

---

## 3. Cấu trúc một golden case

```yaml
id: GT-G4-06
description: "Test reveals prerequisite root gap in common denominator"
child_profile: { school_grade: 4, goals: [khá_giỏi], baseline_skill_states: {...} }
evidence_input:                # chuỗi evidence nạp vào engine
  - { skillId: M4.FRAC.COMMON_DENOM, result: wrong, steps: [...] }
expected:
  gap:        { type: prerequisite_gap, root_skill: M4.FRAC.EQUIVALENT }
  not_flag:   [careless_error]                 # phải KHÔNG phân loại nhầm
  mastery_change: { M4.FRAC.EQUIVALENT: down, M4.GEO.*: unchanged }
  prescription_targets: [M4.FRAC.EQUIVALENT]
  knowledge_level: K2
  thinking_level: T2
tolerance: { mastery: ±5, priority_band: exact }
```

---

## 4. Golden test harness (`/packages/testing`)

- **Pure engine, no network:** nạp evidence_input → chạy deterministic engine → so `expected` trong tolerance.
- **AI decoupled:** classification của LLM được **mock/fixed** trong golden để kết quả deterministic; AI có suite contract riêng.
- **DAG invariants:** test riêng: prerequisite graph acyclic; mọi skill có curriculum mapping; mọi problem_type có (K,T).
- **Recompute invariant:** rebuild derived state từ evidence hai lần → kết quả giống nhau.
- **Discrimination matrix test:** một bảng ma trận chứng minh engine phân biệt đủ 8 loại gap và tách K/T.

---

## 5. Acceptance (gate mở rộng UI)

1. Toàn bộ registry GT-G4-* và GT-G7-* pass trong tolerance.
2. Discrimination matrix pass (8 gap types + K/T separation).
3. DAG + recompute invariants pass.
4. Không golden case nào tạo "global grade level".
5. CI chặn merge nếu golden fail.
