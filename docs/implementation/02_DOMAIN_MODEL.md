# 02 — Domain Model

> **⚠ Một phần bị SUPERSEDED bởi Architecture Migration v1.1 (AI-Generation-First — chờ anh duyệt).** Xung đột + luật mới: `docs/implementation/12`–`17`. Doc này sẽ được cập nhật khi migration được APPROVE.

> Domain được thiết kế quanh **educational reality**, KHÔNG quanh màn hình (screens). UI là projection của domain, không phải ngược lại.

---

## 1. Bounded Contexts (theo Technical Spec §2)

```
identity · family_profile · teacher_contribution
curriculum · skill_graph
evidence · mastery · gap · readiness
practice · assessment · planning · revision
notifications · reporting
```

Nhóm thành 4 khối lớn:
1. **Identity & People** — identity, family_profile, teacher_contribution.
2. **Curriculum Core (mostly static, versioned)** — curriculum, skill_graph, problem_types, thinking taxonomy.
3. **Learner State (append-only + derived)** — evidence, mastery/twin, gap, readiness.
4. **Learning Loop (transactional)** — planning, practice, assessment, revision, reporting, notifications.

---

## 2. Aggregates & Entities

### 2.1 Identity & People

**User** — root cho auth.
- `id, role (parent|child|teacher|admin), authRef, locale, createdAt`.

**Family** (aggregate root)
- `id, ownerParentId`
- có nhiều `ChildProfile`, nhiều liên kết `Parent`, nhiều `TeacherInvite`.

**Parent** — hồ sơ người dùng chính; gắn với `Family`.

**ChildProfile** (aggregate root cho learner state)
- `id, familyId, displayName, schoolGrade, schoolContext (trường/bộ sách), goals[], availableTimeProfile (10|20|30|45 phút)`.
- **Beneficiary**, không phải User đăng nhập độc lập (dùng PIN/child access).

**Teacher** — user optional; liên kết tới child/class qua invite.

**TeacherContribution** (append-only event)
- `id, teacherId (hoặc parentId nếu nhập thay), childId, date, taughtSkillIds[], problemTypeIds[], homeworkRefs[], examRef?`.
- Là một **nguồn Evidence gián tiếp** (context), không phải mastery trực tiếp.

### 2.2 Curriculum Core (versioned, deterministic)

**Curriculum** — bộ chương trình (vd "Toán 4 KNTT"), có `version`.

**CurriculumNode** — cây curriculum.
- `id, curriculumId, source, gradeContext, volume, chapter, lesson, order`.

**Skill** (node của Skill Graph)
- `id (stable global ID), domain, topic, name, description, gradeContext`,
- `curriculumMappings[] (→ CurriculumNode)`,
- `prerequisites[] (→ Skill.id)`, `nextSkills[] (→ Skill.id)`,
- `advancedExtensions[]`.

**Prerequisite** — cạnh có hướng trong DAG.
- `fromSkillId, toSkillId, importance (0–1), crossGrade: boolean`.

**ProblemType** — dạng bài thuộc một skill.
- `id, skillId, name, structure, knowledgeLevel (K0–K5), thinkingLevel (T1–T5)`.
- **Problem-type mastery tách biệt khỏi skill mastery.**

**ThinkingDimension** — chiều tư duy (number_sense, logical_reasoning, …).
- Tạo nên **Thinking Profile**, tách biệt khỏi knowledge mastery.

### 2.3 Learner State

**Evidence** (append-only ledger — KHÔNG bao giờ sửa/xóa)
- `id, childId, source (enum), timestamp, skillId?, problemTypeId?, result, reasoningQuality?, hintDependency?, confidenceTier (A|B|C|D), provenance (manual|scan|assessment|teacher|parent), aiInference? {model, confidence, rawRef}`.
- `EvidenceSource`: school_test, school_exam, school_homework, app_worksheet, app_practice, diagnostic, parent_feedback, teacher_feedback, notebook_scan, teacher_message_scan.

**SkillState** (derived — có thể recompute từ Evidence)
- `childId, skillId, mastery (0–100), confidence (0–1), retention, lastVerifiedAt`.

**Mastery** — kết quả tính từ nhiều tín hiệu (không chỉ accuracy): correctness + hint dependency + reasoning quality + retention + recurrence + evidence confidence.

**ProblemTypeMastery** — `childId, problemTypeId, mastery (0–100)`.

**ThinkingProfile** — `childId, dimension, level/score`.

**KnowledgeGap** (aggregate có lifecycle)
- `id, childId, type (gap_types), targetSkillId, rootSkillId?, severity, priority, lifecycleState, evidenceRefs[], detectedAt`.
- lifecycle: `DETECTED → CONFIRMED → TREATING → IMPROVING → CLOSED → MONITORING`.

**LearningReadiness** (derived) — `childId, targetSkillId, readinessScore, breakdown {prereqMastery, problemTypeMastery, thinkingReadiness, retention}`.

**ChildLearningTwin** — *aggregate view* hợp nhất SkillState + ProblemTypeMastery + ThinkingProfile + KnowledgeGap[] + LearningBehaviour. Không phải bảng riêng mà là projection ổn định của learner state.

**ActualLearningFrontier** — theo domain/skill (không phải một grade duy nhất):
`{ domain → frontierLabel }` (vd `algebraic_transformation: G8_G9_HSG_exposure`). Là **exposure/readiness**, không phải claim mastery toàn grade.

### 2.4 Learning Loop

**LearningContext** — hợp nhất: standard curriculum position + actual taught position + actual learning frontier + upcoming exam. Input cho planning.

**LearningPrescription** — `id, childId, gapId, severity, rootGap, durationDays, sessions, minutesPerSession, exerciseDose {foundation, standard, application, thinking}, retestItems, retentionCheckDays`.

**DailyPlan** — `id, childId, date, availableMinutes, orderedActions[], mix {school, gapRepair, advanced, thinking}`.

**Assignment** — `id, childId, mode, targetSkillIds[], items[] (→ Question)`.

**Question / Item** — `id, skillId, problemTypeId, knowledgeLevel, thinkingLevel, prompt, answerSpec, hints[] (hint ladder)`.

**Submission** — `id, assignmentId, questionId, childAnswer, correct?, hintsUsed, reasoningText?, timeSpent`. → sinh ra Evidence.

**Assessment / AssessmentResult** — `id, childId, source (scan/diagnostic/exam), questionOutcomes[], errorClasses[], evidenceLinks[]`.

**Exam** — `id, childId, date, scope?, inferredScopeConfidence`.

**RevisionPlan** — `id, childId, examId, dayCountdown, priorityItems[], dailyMinutes`.

**WeeklyReport** — `id, childId, weekOf, learned[], progress[], gapsNewOrReduced[], nextWeekMix`.

**Notification** — `id, targetUserId, type, payload, readAt`.

---

## 3. Quan hệ chính (text ERD)

```
User 1─* (role)                              Curriculum 1─* CurriculumNode
Family 1─* ChildProfile                       Skill *─* Skill (Prerequisite DAG)
Family 1─* Parent, 1─* TeacherInvite          Skill 1─* ProblemType
ChildProfile 1─* Evidence (append-only)       Skill *─* CurriculumNode (mappings)
ChildProfile 1─* SkillState (derived)         ProblemType *─1 Skill
ChildProfile 1─* KnowledgeGap                 
ChildProfile 1─* DailyPlan 1─* Assignment 1─* Question
Assignment 1─* Submission ──▶ Evidence
KnowledgeGap 1─1 LearningPrescription
ChildProfile 1─* Exam 1─1 RevisionPlan
ChildProfile 1─* WeeklyReport
TeacherContribution ──▶ LearningContext ──▶ DailyPlan
```

---

## 4. Nguyên tắc invariants ở tầng domain

1. **Evidence là append-only** — mọi thay đổi state đều truy vết được về evidence.
2. **Mastery/Gap/Readiness là derived** — luôn recompute được từ Evidence + rules (pure functions).
3. **Skill ID toàn cục & ổn định** — không partition theo grade; grade chỉ là curriculum mapping.
4. **Problem-type mastery ≠ skill mastery ≠ thinking profile** — ba trục lưu riêng.
5. **Curriculum/Prerequisite/Mastery-transition do deterministic core sở hữu** — LLM không được sửa.
6. **Parent/teacher feedback = hypothesis**, không phải confirmed gap.
7. **Không có "global grade level"** mô tả toàn bộ năng lực.
