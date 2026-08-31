# 04 — Database Model

> Store: **PostgreSQL** (source of truth + audit). Nguyên tắc: **evidence append-only/auditable; mastery recomputable; prerequisite explicit; skills cross-grade; problem-type ≠ skill mastery; thinking ≠ knowledge; AI inference lưu confidence + provenance; nhiều nguồn evidence cùng tồn tại.**

Ký hiệu: PK = primary key, FK = foreign key, `⊕` = append-only (no UPDATE/DELETE), `≈` = derived/recomputable (rebuild từ evidence).

---

## 1. Identity & People

```
users(id PK, role, auth_ref, locale, created_at)
families(id PK, owner_parent_id FK→users, created_at)
parents(id PK, user_id FK→users, family_id FK→families, display_name)
child_profiles(id PK, family_id FK→families, display_name, school_grade,
               school_context jsonb, goals jsonb, available_time_profile,
               created_at)
teachers(id PK, user_id FK→users)
teacher_invites(id PK, family_id FK, teacher_id FK?, child_id FK, class_ref,
                status, invited_by FK→users, created_at)
```

---

## 2. Curriculum Core (versioned, mostly static)

```
curricula(id PK, name, grade_context, version, status, created_at)
curriculum_nodes(id PK, curriculum_id FK, source, grade_context,
                 volume, chapter, lesson, order_index, parent_node_id FK?)

skills(id PK,                      -- STABLE GLOBAL ID (vd M4.ARITH.DISTRIBUTIVE)
       domain, topic, name, description, grade_context, version)
skill_curriculum_map(skill_id FK, curriculum_node_id FK, PRIMARY KEY(skill_id,node_id))

prerequisites(from_skill_id FK→skills, to_skill_id FK→skills,
              importance numeric, cross_grade boolean,
              PRIMARY KEY(from_skill_id,to_skill_id))   -- DAG edges (explicit)

problem_types(id PK, skill_id FK, name, structure,
              knowledge_level, thinking_level)          -- K0–K5 / T1–T5

thinking_dimensions(id PK, code, name)                  -- number_sense, ...

skill_advanced_extensions(id PK, skill_id FK, family, description)
```

> **Cross-grade:** `prerequisites` là DAG toàn cục; một cạnh có thể nối G4→G5…→G9/HSG (`cross_grade=true`). Skill ID **không** mã hóa grade như constraint runtime — grade chỉ là mapping.

---

## 3. Evidence ledger (⊕ append-only, auditable)

```
evidence(id PK, child_id FK, source,                    -- ⊕ NEVER update/delete
         occurred_at, recorded_at,
         skill_id FK?, problem_type_id FK?,
         result jsonb,                                   -- correctness/answer/steps
         reasoning_quality, hint_dependency, time_spent,
         confidence_tier,                                -- A|B|C|D (verified→estimated)
         provenance,                                     -- manual|scan|assessment|teacher|parent
         ai_inference_id FK?)                            -- nếu do AI suy ra

ai_inferences(id PK,                                     -- ⊕ provenance của AI
              model, provider, prompt_ref, raw_output jsonb,
              schema_version, confidence numeric,
              latency_ms, token_in, token_out, cost,
              safety_flags jsonb, created_at)

teacher_contributions(id PK, child_id FK, actor_user_id FK,  -- teacher OR parent
                      contributed_as, occurred_on,
                      taught_skill_ids jsonb, problem_type_ids jsonb,
                      homework_refs jsonb, exam_ref jsonb, created_at)  -- ⊕

uploads(id PK, child_id FK, kind, storage_key, signed_url_meta,
        status, created_at)                             -- ảnh/PDF/worksheet
```

**Audit:** mọi thay đổi state quan trọng có bản ghi truy vết về `evidence` + `ai_inferences`. Không có hard-delete evidence trong MVP (chỉ soft archival nếu bắt buộc theo retention policy).

---

## 4. Learner State (≈ derived, recomputable)

```
skill_states(child_id FK, skill_id FK, mastery, confidence,      -- ≈
             retention, last_verified_at, computed_from_evidence_seq,
             PRIMARY KEY(child_id,skill_id))

problem_type_mastery(child_id FK, problem_type_id FK, mastery,   -- ≈  (tách khỏi skill)
                     PRIMARY KEY(child_id,problem_type_id))

thinking_profile(child_id FK, dimension_id FK, level, score,     -- ≈  (tách khỏi knowledge)
                 PRIMARY KEY(child_id,dimension_id))

knowledge_gaps(id PK, child_id FK, gap_type, target_skill_id FK,
               root_skill_id FK?, severity, priority,
               lifecycle_state,                                  -- DETECTED..MONITORING
               evidence_refs jsonb, detected_at, updated_at)

gap_lifecycle_events(id PK, gap_id FK, from_state, to_state,     -- ⊕ audit trail
                     reason, evidence_ref, created_at)

learning_readiness(child_id FK, target_skill_id FK, readiness_score,
                   breakdown jsonb, computed_at,
                   PRIMARY KEY(child_id,target_skill_id))        -- ≈

actual_learning_frontier(child_id FK, domain, frontier_label,    -- ≈ per-domain
                         updated_at, PRIMARY KEY(child_id,domain))
```

> `child_learning_twin` **không** là bảng riêng — nó là view/projection tổng hợp `skill_states + problem_type_mastery + thinking_profile + knowledge_gaps + learning_behaviour`.

`computed_from_evidence_seq` cho phép biết state được tính từ evidence tới đâu → **recompute idempotent** khi rule/coefficient thay đổi.

---

## 5. Learning Loop (transactional)

```
learning_context(id PK, child_id FK, standard_position jsonb,
                 actual_taught_position jsonb, frontier jsonb,
                 upcoming_exam_id FK?, updated_at)

learning_prescriptions(id PK, child_id FK, gap_id FK, severity, root_gap,
                        duration_days, sessions, minutes_per_session,
                        dose jsonb,           -- {foundation,standard,application,thinking}
                        retest_items, retention_check_days, status, created_at)

daily_plans(id PK, child_id FK, plan_date, available_minutes,
            mix jsonb, ordered_actions jsonb, created_at)

assignments(id PK, child_id FK, daily_plan_id FK?, mode,
            target_skill_ids jsonb, created_at)

questions(id PK, skill_id FK, problem_type_id FK, knowledge_level,
          thinking_level, prompt jsonb, answer_spec jsonb,
          hints jsonb,                        -- hint ladder
          origin,                             -- authored | ai_generated
          ai_inference_id FK?)

assignment_items(assignment_id FK, question_id FK, order_index,
                 PRIMARY KEY(assignment_id,question_id))

submissions(id PK, assignment_id FK, question_id FK, child_id FK,
            child_answer jsonb, correct boolean?, hints_used,
            reasoning_text, time_spent, submitted_at)  -- → sinh evidence

assessments(id PK, child_id FK, source, upload_id FK?, created_at)
assessment_results(id PK, assessment_id FK, question_outcomes jsonb,
                   error_classes jsonb, evidence_links jsonb)

exams(id PK, child_id FK, exam_date, scope jsonb?, inferred_scope_confidence)
revision_plans(id PK, child_id FK, exam_id FK, day_countdown,
               priority_items jsonb, daily_minutes, created_at)

weekly_reports(id PK, child_id FK, week_of, learned jsonb, progress jsonb,
               gaps_delta jsonb, next_week_mix jsonb, created_at)

notifications(id PK, target_user_id FK, type, payload jsonb, read_at, created_at)
```

---

## 6. Migration & integrity rules

1. **Mọi thay đổi schema qua migration** (versioned, forward-only + rollback script).
2. `evidence`, `ai_inferences`, `teacher_contributions`, `gap_lifecycle_events` chỉ INSERT (enforce ở app layer + DB grant).
3. Curriculum/skill/prerequisite thay đổi qua **version bump**, không mutate bản đang dùng (giữ reproducibility của mastery đã tính).
4. Foreign keys explicit; prerequisite DAG được validate **không có chu trình** ở CI (golden test riêng).
5. Derived tables có thể `TRUNCATE + rebuild` từ evidence bất kỳ lúc nào — đây là bài test bất biến "recompute = same result".
6. PII của child: consent-gated, retention/deletion controls, no public profile.
