# 10 — Implementation Roadmap

> **⚠ Một phần bị SUPERSEDED bởi Architecture Migration v1.1 (AI-Generation-First — chờ anh duyệt).** Xung đột + luật mới: `docs/implementation/12`–`17`. Doc này sẽ được cập nhật khi migration được APPROVE.

> Nguyên tắc: **không sang phase sau khi acceptance criteria phase hiện tại chưa đạt.** Deterministic education core + golden tests đi trước UI (Tech Spec §15).

Mỗi phase: **Goal · Deliverables · Dependencies · Acceptance · Tests · Risks.**

---

## Phase 0 — Foundation
- **Goal:** Monorepo, TS strict, CI, migrations, schema/validation nền.
- **Deliverables:** monorepo layout (`/apps /packages /services`), tooling (lint, strict tsconfig, test runner), Postgres + migration framework, Zod schema convention, `/packages/domain` khung types, secrets/env, structured logging + AI cost hooks (stub).
- **Dependencies:** none.
- **Acceptance:** CI xanh; `pnpm test` chạy; migration up/down; strict mode, `any` bị chặn ở lint.
- **Tests:** smoke build + 1 migration test.
- **Risks:** over-engineering sớm → giữ tối giản.

## Phase 1 — Education Core (data + graphs)
- **Goal:** Chuẩn hóa curriculum Grade 4 + Grade 7 thành **stable Skill IDs**, dựng graphs.
- **Deliverables:** `/packages/math-data` (curriculum, skill_graph, prerequisite_graph, problem_types, K/T taxonomy, advanced_extensions) cho grade4 & grade7; loader + validators; **unified Skill ID scheme** (giải quyết R1).
- **Dependencies:** P0.
- **Acceptance:** prerequisite DAG acyclic; mọi skill có curriculum mapping; mọi problem_type có (K,T); ID scheme thống nhất, cross-grade edges hợp lệ.
- **Tests:** DAG invariants; schema validation của data files.
- **Risks:** ID scheme cần chốt trước (R1); mapping SGK→skill chưa đầy đủ item-level.

## Phase 2 — Evidence & Learning Context
- **Goal:** Evidence ledger append-only + Learning Context.
- **Deliverables:** bảng `evidence`, `ai_inferences`, `teacher_contributions`, `uploads`; evidence service (append-only, confidence tier A–D); learning_context builder (standard + actual taught + frontier).
- **Dependencies:** P1.
- **Acceptance:** không path nào UPDATE/DELETE evidence; parent/teacher/manual/assessment evidence cùng tồn tại; context dựng được không cần teacher.
- **Tests:** append-only invariant; context build từ evidence hỗn hợp.
- **Risks:** provenance thiếu → khó audit.

## Phase 3 — Child Learning Twin
- **Goal:** Derived state recomputable: mastery, problem-type mastery, thinking profile.
- **Deliverables:** mastery engine (đa tín hiệu, không chỉ accuracy), problem_type_mastery, thinking_profile, actual_learning_frontier per-domain; recompute job.
- **Dependencies:** P2.
- **Acceptance:** rebuild từ evidence **idempotent**; ba trục tách biệt; không sinh global grade level.
- **Tests:** recompute invariant; mastery không đổi mạnh do careless error.
- **Risks:** coefficients chưa calibrate (R3) → để config + đánh dấu provisional.

## Phase 4 — Gap & Readiness Engine
- **Goal:** Gap detection, root-gap diagnosis, priority, lifecycle, readiness.
- **Deliverables:** gap_rules, root-gap trace, gap_score, lifecycle state machine + `gap_lifecycle_events`, readiness engine, learning_prescription generator.
- **Dependencies:** P3.
- **Acceptance:** phân biệt đủ 8 loại gap; root-gap trace prereq; gap không đóng sau một lần đúng; readiness cho parallel gap repair.
- **Tests:** **Golden discrimination matrix** bắt đầu ở đây.
- **Risks:** over/under-diagnosis; cần calibrate.

## Phase 4.5 — GOLDEN GATE (bắt buộc trước UI)
- **Goal:** Chứng minh engine đúng trước khi mở rộng UI.
- **Deliverables:** `/packages/testing` harness; toàn bộ registry GT-G4-*/GT-G7-*; discrimination matrix; K/T separation cases.
- **Acceptance:** **tất cả golden pass trong tolerance**; CI chặn merge nếu fail.
- **Gate:** không sang Phase 6 (Parent UI mở rộng) nếu chưa pass.

## Phase 5 — Planning & Practice
- **Goal:** Daily/weekly plan, Learning Mix, Next Best Learning Action, adaptive practice + hint ladder.
- **Deliverables:** planning engine (ROI/phút), learning_mix theo tình huống, assignment/question model, hint ladder, stretch-zone selection, submission→evidence loop.
- **Dependencies:** P4.5.
- **Acceptance:** plan tôn trọng time budget + prereq + gaps + goal; "No plan needed" hoạt động; submission ghi evidence.
- **Tests:** planner golden (mixed-level → mix theo skill); hint ladder state machine.
- **Risks:** AI generation chất lượng (P.5 dùng authored trước, AI sau).

## Phase 6 — Parent Experience (priority 1)
- **Goal:** Parent web + mobile: Home, Context, Scan→AI confirm, Daily Plan, Teach Me 3', Teaching Session, Twin/Progress, Gap/Prescription.
- **Dependencies:** P5 + API projections.
- **Acceptance:** Home→bắt đầu học ≤ 3 thao tác; scan luôn có confirmation; parent controls gap (follow/lighter/intensify/later); progress không có điểm tổng.
- **Tests:** E2E parent happy path; projection tests.

## Phase 7 — Child Experience (priority 2)
- **Goal:** Child minimal app (4 nav) từ **child-safe projection**.
- **Acceptance:** child token bị server từ chối field nhạy cảm; UI không lộ gap/mastery/ranking; one-step-per-viewport; reasoning prompt sau thử thách.
- **Tests:** child projection deny tests; offline queue submission.

## Phase 8 — Teacher Quick Update (priority 3)
- **Goal:** Teacher lightweight update < 60s; parent nhập thay được.
- **Acceptance:** flow ~1 phút; app đầy đủ khi không có teacher.
- **Tests:** teacher contribution → context update.

## Phase 9 — Assessment & Revision
- **Goal:** Scan-test → diagnosis → remediation; Exam/Revision mode; Weekly Report; notifications.
- **Acceptance:** exam flow chạy khi chỉ có ngày thi + recent context; post-exam phân loại lost points; weekly report gợi ý mix tuần tới.
- **Tests:** revision priority golden; scope inference confirm flow.

## Phase 10 — Pilot Hardening
- **Goal:** Pilot Grade 4 + Grade 7 thực tế; observability, cost, security, retention.
- **Acceptance (DoD MVP):** parent tự lập context không cần teacher; teacher < 1 phút; child chỉ thấy task; engine hỗ trợ above-grade + parallel gap repair; **mọi khuyến nghị truy vết được**; golden pass deterministic; AI cost/latency theo dõi được.

---

## Thứ tự phụ thuộc (tóm tắt)
```
P0 → P1 → P2 → P3 → P4 → [P4.5 GOLDEN GATE] → P5 → P6 → P7 → P8 → P9 → P10
                                    │
                    UI mở rộng chỉ sau khi Golden Gate pass
```
