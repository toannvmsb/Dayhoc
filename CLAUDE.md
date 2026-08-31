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
- **Parent**: account owner + legal guardian. Full projection + quản lý consent + mọi data-subject-rights của con.
- **Child**: login = **username + password do bố mẹ tạo** (con đổi được), scope child-safe projection. **PIN 4 số = shortcut vào bài được giao**, KHÔNG phải login. Child-safe từ SERVER — KHÔNG gap score/mastery/ranking/analytics/parent controls/consent/billing. Nav tối đa 4.
- **Teacher**: chỉ context được mời; update < 60s; app đầy đủ khi không có teacher. KHÔNG thấy Twin/Gap.

## AI cost invariants (Pricing + AI Cost Guardrails v1.0 — `docs/implementation/PRICING_AND_COST_GUARDRAILS.md`)
- **Luna-first**: `resolveRoute()` — 85–95% call ở deterministic / question-bank / Luna. Escalate chỉ khi đo được (confidence thấp, mâu thuẫn, K4–K5/T4–T5…). Advanced (Sonnet 5 vs Terra) benchmark-gated.
- **LLM không bao giờ sở hữu**: production skill IDs, prerequisite DAG, permissions, consent, gap-lifecycle thresholds, mastery formula, time-budget, billing/quota.
- **Budget gate trước mỗi metered call** (`checkBudget`): per-plan target + hard ceiling; graceful fallback; `safetyCritical` (privacy/xoá/kiểm chứng) luôn bypass. Không retry-loop nào vượt ceiling.
- **Margin floor 50%** doanh thu kể cả ở AI hard ceiling. Giá LOCKED (Free/169K/229K/329K) — không giảm vì COGS thực thấp.
- **Public model prices = config effective-dated** (`ai_pricing_registry` / `PricingRegistry`), KHÔNG hard-code vào domain logic. FX VND cấu hình được.
- Mọi call AI/OCR → `ai_usage_events` (pseudonymous, INSERT-only).

## Privacy invariants (anh duyệt P-05 — `docs/implementation/PRIVACY_ARCHITECTURE.md`)
- Privacy-by-Design, theo NĐ 13/2023. **Consent versioned + auditable** (`consent_records` ⊕), không dùng boolean.
- **Data minimization tới AI**: `minimizeForProvider()` bắt buộc — strip PII, thay childId bằng opaque ref, từ chối nếu vượt category cho phép hoặc `training_allowed=true`.
- **Raw upload retention 30 ngày** (configurable), purge sau khi OCR→evidence xong. Mọi upload private, signed URL, không public.
- **Append-only ≠ không xoá được** — quyền xoá data trẻ em chạy qua deletion workflow đặc quyền (tắt trigger cho transaction), xoá theo thứ tự, SLA ≤ 72h, ghi `deletion_jobs`.
- Child API projection: 3 lớp enforce (type + `assertChildSafe` + route gate).

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
- **P6 Parent Experience** `7094317` — `@copilot/api-contract` + `@copilot/projections` (parent full views + **child-safe projection** absent-by-construction + `assertChildSafe` guard). `apps/web` (Next.js): Parent Home / Progress / Gap Detail trên design-tokens Hướng 1A, data engine thật. Còn thiếu (không chặn): scan→AI confirm, teaching session, mobile — `PENDING_APPROVAL.md §C1`.
- **P7 Child Experience** `2d4850d` — child projections (one-question view, result + reasoning prompt §35, challenge), `OfflineSubmissionQueue` (FIFO, idempotent §17). `apps/web/child/*`. Verified.
- **P8 Teacher Quick Update** `7cb8276` — `buildTeacherHome`/`buildTeacherUpdateForm` (grade-scoped, ~40s; không thấy Twin/Gap). `apps/web/teacher/*`. Flow test: contribution (teacher/parent proxy) → parent context update.
- **P9 Assessment & Revision** `82c3933` — `@copilot/revision`: `inferExamScope`, `buildRevisionPlan` (§28), `diagnoseAssessment` (§29), `buildWeeklyReport`, notifications. `apps/web`: Exam (P13) + Weekly Report (P14).
- **P10 Pilot Hardening** `<pending>` — `@copilot/ai` (replaceable LLM/Vision provider port + `AiOrchestrator.runStructured`: validate schema + record cost/latency/provenance; `MockLlmProvider` giữ CI deterministic), `@copilot/audit` (`traceGap`/`tracePrescription`/`tracePlanAction` → rule + evidence + AI ids), `services/api` (`createApi` role-gated: family scope + child token chỉ child-safe + `assertChildSafe` enforce), `pilot-dod.test.ts` (DoD checklist executable), `docs/implementation/SECURITY_AND_RETENTION.md`.

## Current phase
**P0–P10 vertical slice xong + REAL DATA integrated. `145 tests xanh`.**

### Data (anh gửi 2026-08-31, commit `5e7d252`+)
- **Math Dev Core v1.0** = source of truth. `packages/math-data/data/dev-core/` YAML → `scripts/build-kb.mjs` → `src/data/*.json` (commit output; `npm run data -w @copilot/math-data` regenerate). KB: **94 skills** (52 M4 + 37 M7 provisional + 5 synthetic above-grade families), 112 curriculum nodes.
- `data/bridges.yaml` — 9 M4→M7 cross-grade prereq bridges (implementation-team, provisional, cần educator review P-01).
- **G7.\* IDs migrated → M7.\*** across toàn repo.
- **Golden datasets** ở `packages/testing/golden-data/`: 120 questions, 360 error cases, 15 curated scenarios, 12 profiles.

### Real engine tests (không chỉ schema)
- `golden/mapping.test.ts` — 120/120 question skill_ids resolve (100%).
- `gap-engine/error-signature.ts` (`classifyErrorSignature`) + `golden/error-diagnosis.test.ts` — AI đề xuất `error_signature`, engine **deterministic** map (+ prereq state + thinking level) → gap type. **360/360** khớp `expected_gap_type`; non-negotiables enforced (careless không thành knowledge gap; 1 observation không high-confidence; T4/T5 + knowledge mạnh → reasoning_gap; unobserved prereq = neutral không phải 0).
- `golden/curated.test.ts` — 9/15 curated hard-case scenarios.

Còn lại: `PENDING_APPROVAL.md` (P-01..05 anh duyệt; calibrate coefficients bằng pilot; OCR/scan flow; mobile app; 8 golden question cases cần domain data sâu hơn).
Web dev: `npm run dev --workspace @copilot/web` (port 3100). browser-preview `.claude/launch.json` đọc từ cwd (PhongThuy) — start web bằng Bash + navigate localhost.

## Approved decisions
- **D1** Skill ID grade-opaque + metadata `grade_context`. Từ 2026-08-31: source data = Math Dev Core v1.0 (`M4.*` + `M7.*`).
- **D2** Golden registry hợp nhất (thay bằng golden dataset thật của anh — `packages/testing/golden-data/`).
- **D3** Project root = `D:\Lap trinh\Claude\Dayhoc\`; KHÔNG đụng repo PhongThuy.
- **D4** Stack: monorepo (npm workspaces) + Next.js + Expo/RN + PostgreSQL + Redis + S3 + Claude LLM.
- **P-01** (2026-08-31) Em tự rà skill graph/DAG lớp 7 theo SGK → xuất bản đề xuất cho anh duyệt (chưa freeze `M7.*` ID).
- **P-02** Giữ coefficients provisional tới khi có pilot data.
- **P-03** Con login = username+password (bố mẹ tạo, con đổi được). PIN 4 số = shortcut vào bài được giao, không phải login.
- **P-04** LLM/OCR provider: **architecture đã chốt & code** (Pricing + AI Cost Guardrails v1.0 — Luna-first routing, pricing registry, margin floor 50%, budget engine + hard ceilings, cost telemetry, provider adapter). **Đợt 2 (2026-09-01):** Q1 hoãn benchmark ảnh → pilot chạy **Luna mặc định**, advanced model (Sonnet 5 vs Terra) quyết sau bằng AI COGS pilot thật. Q2 ca `advanced` chưa có model → `resolveRoute` trả `effectiveTier:'luna'` + `effort:'high'` + `reviewReason` (không chặn, không tự chọn provider). Xem `docs/implementation/PRICING_AND_COST_GUARDRAILS.md`. Runtime vẫn `MockLlmProvider`.
- **P-05** 17 nguyên tắc Privacy-by-Design → `docs/implementation/PRIVACY_ARCHITECTURE.md`. Architecture phải *capable*; consent UI làm sau.

## Working rule
Thay đổi lớn ảnh hưởng LOCKED MVP → dùng **PROPOSED CHANGE (Reason/Benefits/Risks/Impact/Recommendation)** và chờ duyệt. Quyết định nhỏ tự làm. Không mở rộng scope âm thầm.
