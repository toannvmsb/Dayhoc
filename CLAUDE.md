# CLAUDE.md — AI Parent Learning Copilot

> Bộ nhớ dự án cho các phiên Claude Code sau. Ngắn gọn, không copy nguyên spec.
> Nguồn sự thật đầy đủ: `File du an/` (6 tài liệu LOCKED v1.0) + `docs/implementation/` (11 tài liệu kế hoạch).

## Product mission
AI copilot cho **BỐ MẸ** giúp con học Toán hiệu quả (tiểu học→THCS). App không dạy thay bố mẹ; app loại bỏ phần chuẩn bị/phân tích/soạn bài. Tối ưu **Parent Time → Child Progress** và **Verified Skills Mastered / Month**. Primary user = Parent; beneficiary = Child; contributor tùy chọn = Teacher.

## Locked MVP scope (v1.0)
Platforms: Web + iOS + Android. Pilot: Toán **lớp 4** + **lớp 7**. Bảy capability:
1 Learning Context · 2 Child Learning Twin · 3 Daily Learning Plan · 4 Parent Teaching Copilot · 5 Adaptive Practice & Thinking · 6 Assessment & Gap Diagnosis · 7 Learning & Revision Engine.
**Out of scope:** LMS sâu, teacher analytics phức tạp, social/leaderboard, marketplace gia sư, đa môn, gamification nặng, school admin.

## Education model invariants (NON-NEGOTIABLE)
- `school_grade ≠ learning_level` — grade là **context, không phải trần**.
- Loop: Evidence → Context → Twin → Gap/Root → Readiness → Prescription → Plan → Practice → Assessment → Evidence.
- Hai trục độc lập: **Knowledge Level K0–K5** vs **Thinking Level T1–T5** (K2 vẫn có thể T5). Không đánh đồng "advanced" = "grade cao hơn".
- Problem-type mastery ≠ skill mastery ≠ thinking profile (lưu riêng).
- Gap lifecycle: DETECTED→CONFIRMED→TREATING→IMPROVING→CLOSED→MONITORING; **không đóng gap sau một lần đúng**; careless error không hạ mastery mạnh.
- Parent/teacher feedback = **hypothesis**, không phải confirmed gap.
- 10 luật Math Core §39 áp dụng đầy đủ.

## Architecture principles
- Monorepo, API-first, role-based projection. Modular monolith trước.
- Stack: Next.js/React (web), React Native/Expo (mobile), TypeScript service layer, PostgreSQL, Redis (cache/queue/jobs), S3-compatible storage, LLM+OCR/Vision sau adapter.
- **Deterministic core sở hữu**: skill IDs, prerequisite DAG, curriculum mappings, evidence, mastery/gap/readiness transitions, permissions, audit.
- **AI chỉ hỗ trợ**: OCR/vision, candidate skill mapping, question generation, hints, explanations, parent summaries — **luôn qua JSON schema validation + confidence + fallback**. LLM không sửa prerequisite/mastery.
- Evidence **append-only/auditable**; derived state **recomputable** (idempotent).
- Skill IDs **toàn cục**, không partition theo grade; DAG cross-grade G4→…→G9/HSG.

## Role restrictions
- **Parent**: full projection (context, twin, gap/prescription, plan, report, controls).
- **Child**: **child-safe projection từ SERVER** — chỉ tasks/content/hints/feedback. KHÔNG gap score, mastery, ranking, analytics, parent controls. Nav tối đa 4: Hôm nay·Ôn tập·Bài tập·Thử thách.
- **Teacher**: chỉ context được mời; update < 60s; app đầy đủ khi không có teacher.

## Coding conventions
- TypeScript **strict**; tránh `any`. Schema (Zod) validate ở mọi boundary + AI I/O.
- Domain/service tách khỏi UI; **không business logic trong UI component**.
- AI/OCR/Storage providers **replaceable** (adapter). Secrets ngoài source control.
- Mọi thay đổi DB qua **migrations**. Structured logging + track AI token/cost/latency.
- Deterministic education logic **bắt buộc có test**; giữ auditability cho mọi quyết định giáo dục.

## Folder structure
`/apps/{web,mobile}` · `/packages/{domain,schemas,education-core,observability,math-data,api-contract,api-client,ai,design-tokens,testing}` · `/services/{api,workers}` · `/migrations` · `/docs`.
Monorepo dùng **npm workspaces** (corepack/pnpm bị chặn quyền trên Windows — quyết định nhỏ). Packages đã có: `@copilot/{domain, schemas, education-core, observability, math-data, design-tokens, evidence, learning-context, learning-twin, gap-engine, testing}`.
Quyết định nhỏ: `evidence.skill_id`/`problem_type_id` là **TEXT, không FK** — skill graph là static versioned data của `@copilot/math-data`, validate ở app layer.

## Design system
Direction **LOCKED = "Hướng 1A · Bình tĩnh & ấm"** (anh chọn từ 3 hướng): nền kem `#FFFBF5`, teal `#0E9384`, `Plus Jakarta Sans`, single-column card stack, Today Plan = thanh mix tỉ lệ. Nguồn: `docs/design/handoff/` (Claude Design export) + UI/UX Spec §5,§19,§20. Tokens ở `@copilot/design-tokens` (web dùng `/css`, RN dùng object). Inventory 20 màn mobile + 2 web map theo capability/role: `docs/implementation/DESIGN_SYSTEM.md`. **Screens dựng ở Phase 6→7→8**, không sớm hơn.

## Test requirements
- Golden educational tests (registry `GT-G4-*`/`GT-G7-*`) + discrimination matrix (8 gap types + K/T separation) phải pass **trước khi mở rộng UI** (Golden Gate ở Phase 4.5).
- DAG acyclic invariant; recompute-idempotent invariant; child-projection deny tests; AI schema contract tests (mock provider trong CI).

## Phase history (mỗi phase 1 commit, tests xanh)
- **P0 Foundation** `04884d7` — monorepo npm-workspaces, TS strict, eslint ban `any`, vitest, node-pg-migrate, portable Postgres 16.4.
- **P1 Education Core** `3302f2b` — `@copilot/math-data` (schema + JSON G4/G7 slice + loader/DAG), `@copilot/design-tokens` (Hướng 1A).
- **P2 Evidence & Context** `cddc9b3` — `@copilot/evidence` (append-only ledger, DB triggers), `@copilot/learning-context` (teacher-optional builder).
- **P3 Child Learning Twin** `a70daa0` — `@copilot/learning-twin` (multi-signal mastery, 3 trục tách, per-domain frontier, recompute idempotent).
- **P4 Gap & Readiness** `6e45836` — `@copilot/gap-engine` (8-type classifier + priority order + ruledOut, root-gap trace chỉ vào prereq evidenced+weak, gap_score §21, lifecycle không-đóng-sau-1-lần-đúng, readiness ready/parallel_repair/repair_first, prescription §23 + 4 lựa chọn parent).
- **P4.5 Golden Gate** — `@copilot/testing`: harness + discrimination matrix (8 gap + K/T) + golden registry (10 case pass, 8 `it.todo` chờ data D-01) + `golden-gate.test.ts` (DAG/recompute/no-global-level) = cổng CI.
- **P5 Planning & Practice** `398997c` — `@copilot/planning` (Learning Mix §24, NBLA ROI/phút §40, `buildDailyPlan` + "no plan needed" §17), `@copilot/practice` (authored question bank + 6-rung hint ladder §17, stretch-zone, assignment, `submissionToEvidence` đóng loop §29).
- **P6 Parent Experience** `<pending>` — `@copilot/api-contract` (view-model types) + `@copilot/projections` (parent full views + **child-safe projection** `buildChildToday` với sensitive fields absent by construction + `assertChildSafe` runtime guard). `apps/web` (Next.js): Parent **Home / Progress / Gap Detail** render bằng `@copilot/design-tokens` (Hướng 1A), data từ engine thật (`demo-scene.ts`). Verified in browser. Còn thiếu (không chặn): scan→AI confirm, teaching session, mobile — xem `PENDING_APPROVAL.md §C1`.

## Current phase
**Phase 7 — Child Experience** (đang làm). Blockers → `docs/implementation/PENDING_APPROVAL.md` (autonomous, anh duyệt sau).
Web dev: `npm run dev --workspace @copilot/web` (port 3100). Note: browser-preview `.claude/launch.json` đọc từ repo PhongThuy (cwd), nên start web bằng Bash + navigate localhost.

## Approved decisions (anh duyệt 2026-08-30)
- **D1** Skill ID grade-opaque + metadata `grade_context`; giữ `M4.*`/`G7.*` làm alias. (đã encode ở `@copilot/domain`)
- **D2** Golden registry hợp nhất `GT-G4-*`/`GT-G7-*` (alias giữ lại).
- **D3** Project root = `D:\Lap trinh\Claude\Dayhoc\`; KHÔNG đụng repo PhongThuy.
- **D4** Stack: monorepo (npm workspaces) + Next.js + Expo/RN + PostgreSQL + Redis + S3 + Claude LLM.
- **D5** Cần chuyên gia Toán review prerequisite DAG trước pilot (anh chỉ định sau).

## Working rule
Thay đổi lớn ảnh hưởng LOCKED MVP → dùng **PROPOSED CHANGE (Reason/Benefits/Risks/Impact/Recommendation)** và chờ duyệt. Quyết định nhỏ tự làm. Không mở rộng scope âm thầm.
