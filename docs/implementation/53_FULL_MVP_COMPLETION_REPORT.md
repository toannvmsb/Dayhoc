# DạyZi — FULL MVP COMPLETION (M1–M12 + mobile)

Baseline: `main @ 61ba63d` (605 pass). End state: **11 commits**, `main @ dd1b24c`,
**628 test / 2 skip / 0 fail**, tsc + web/mobile typecheck + `next build` +
Playwright (8/8) + eslint all green. 19 migrations (all additive, all
up/down/up verified). No paid AI, no paid OCR, no LIVE generation.

| Commit | Milestone |
|---|---|
| `e8eba36` | M1 Student web + parent-managed Student access |
| `7bb2b5b` | M2 Teacher web workspace |
| `bbf8535` | M3 Relationship / permission / school-class UI |
| `f211a5a` | M4 Evidence upload + document-vision ingestion |
| `8641d50` | M5 Gap Detail + Parent Teaching Copilot + IX recompute-if-stale |
| `21b3077` | M6 Exam intelligence — revision map + post-exam diagnosis |
| `b7a45d8` | M7 Entitlements + Settings + real Child-profile deletion |
| `71cc5dc` | M8 Full-web golden-journey E2E (Playwright) |
| `203228d` | M9 Mobile foundation — HTTP API + Expo shell |
| `f766468` | M10 Mobile feature parity — Parent / Student / Teacher |
| `dd1b24c` | M11 Mobile device / UX polish |
| (this)   | M12 Release readiness — report, M42/M43/M49, docs |

---

## A. Student web workspace

`/hoc-sinh`, `/hoc-sinh/bai-tap`, `/hoc-sinh/on-tap`, `/hoc-sinh/tien-bo`
(+ `/hom-nay` alias), `StudentNav`. Child resolved through the **ACTIVE**
`student_account_links` row server-side. Child-safe by construction: no gap
severity, no Twin confidence, no teacher permissions, no school comparison, no
parent notes. Student may build their own short practice within their own scope.

## B. Student login / linking

Parent-managed: `createStudentAccess` (registers `hs-<childId8>@dayzi.local` +
`linkStudentAccount` GUARDIAN_MANUAL → ACTIVE), `getStudentAccess`,
`revokeStudentAccess` (immediate — verified: revoked student is denied). One
ACTIVE link per child (DB unique index). Child ≠ User; the Child Profile is
never duplicated.

## C. Teacher web workspace

`/giao-vien` areas: Học sinh (list + permission-aware detail), Lớp học, Cập
nhật học tập (contribution form), Bài giao (honest "LIVE generation OFF"),
Kết nối (redeem invite code + relationship inbox/outbox). `teacherCreateAssignment`
returns 403. Teacher self-registration at `/welcome?mode=teacher`.

## D. Permission-aware teacher detail

`teacherGetTwinSummary` / `teacherGetGaps` authorize on
`VIEW_LEARNING_TWIN_SUMMARY` / `VIEW_SELECTED_GAPS` and **throw** when the parent
has not granted them — the page catches and shows "chưa được cấp quyền". Teacher
DTOs carry band words only (vững / đang_ổn_định / cần_củng_cố), never scores,
never hidden Twin/gap internals.

## E. Relationship UI (parent)

`/be/[childId]/ket-noi` rebuilt from stub: pending requests (accept/reject),
per-link permission editor grouped as **Thông tin lớp học / Bài học & bài giao /
Thông tin học tập cá nhân / Nhạy cảm (mặc định TẮT) / Trao đổi**, invite-code
generator, immediate "Ngừng kết nối". No enum names shown. Fixed a latent bug:
invite-code requests target the child (no `target_user_id`) and were invisible
in every inbox — `listRelationshipRequests` now folds in pending requests for
every child the parent guards.

## F. School / class UI (parent)

`/be/[childId]/truong-lop`: search / propose school, gán trường, PRIMARY vs
SUPPLEMENTARY / HSG_TEAM / TUTOR_GROUP class enrolment, privacy mode
(PRIVATE_LEARNING / LINKED_PRIVATE / LINKED_SHARED) explained in Vietnamese,
change privacy in place. PROPOSED enrolment never becomes ACTIVE context (HC09
intact).

## G. Evidence upload + document vision (M4)

New `@copilot/uploads`:
- `UploadStorageAdapter` — `LocalFsUploadStorageAdapter` (dev default),
  `InMemoryUploadStorageAdapter` (tests), `SupabaseStorageAdapter` (prod,
  behind the abstraction, ENV_REQUIRED). `resolveUploadStorageAdapter(env)`.
- `DocumentVisionAdapter` — `MockDocumentVisionAdapter` (deterministic, no
  network — the default **everywhere**), `OpenAiVisionAdapter` (only when
  `DZ_LIVE_VISION=1` AND `OPENAI_API_KEY`). No upload spends money by accident.
- `UploadIngestionService` state machine: UPLOAD_CREATED → UPLOADED → READING →
  ANALYZING → MAPPED → NEEDS_CONFIRMATION → CONFIRMED, FAILED reachable from any
  processing state.

Migration `1757894400000` (additive/reversible): `uploads` (existing append-only
ledger) gains immutable provenance columns; new **mutable** `upload_analysis`
(no append-only trigger). Binary never in Postgres.

**Low confidence never silently becomes VERIFIED evidence.** On confirm only
parent-confirmed items → append-only evidence, `provenance = 'scan'`, tier B/C
— NEVER 'A' (verified). Unconfirmed low-confidence items are dropped. Derived
state invalidated after; the Twin recomputes on next read (never mutated here).

## H. Gap Detail screen

`/be/[childId]/diem-can-cai-thien/[gapId]`: why DạyZi thinks so, affects,
lifecycle strip, prescription. Gap lifecycle in Vietnamese: Mới phát hiện /
Đã xác nhận / Đang củng cố / Đang tiến bộ / Đã khắc phục / Đang theo dõi.

## I. Parent Teaching Copilot

`buildParentTeachingPlan` (deterministic — KB + reference library, **no LIVE
AI**). Coaches the PARENT: what this KIND of difficulty means, a step-by-step
script (what to SAY + the pedagogy WHY), questions to check understanding,
common mistakes, how to praise, ONE worked example for the parent to model,
what to do if the child is still stuck. Per-gap-type scaffolds for all 11 gap
types. `/be/[childId]/day-con`. Not a worked answer for the child.

## J. IX — recompute-if-stale persisted learning state

`refreshLearningState(childId)`: run the tested pipeline once, then — **only
when the persisted TWIN snapshot is stale** (evidence_count or state_version
moved) — re-persist `learning_state_snapshots` (TWIN/GAPS/CONTEXT, version +
content hash), `skill_states`, `knowledge_gaps`, `learning_plans`. A read with
no new evidence skips all writes (verified: `computed_at` unchanged).
`submitPractice` and `confirmUploadAnalysis` call `invalidateDerived`. All
parent/student/teacher learning reads share this path (removed 4 duplicate
inline twin+gap recomputes).

## K. Exam intelligence (M6)

Migration `1757980800000`: `exams` (mutable status SCHEDULED → SCOPE_CONFIRMED
→ COMPLETED) + `exam_results` (per-question outcomes + diagnosis blob). Revision
plan is deterministic — recomputed on read, not stored.

Flow: `createExam` → `inferExamScope` from recent context → `confirmExamScope`
→ `getRevisionMap` (`buildRevisionPlan`: probability_in_exam × gap × forgetting
× importance × prereq_impact) → `recordExamResult` → `diagnoseAssessment`
classifies every lost point. Vietnamese labels: **Bất cẩn / Hổng kiến thức /
Hổng kiến thức nền / Sai phương pháp / Sai khâu thực hiện / Không nhận ra dạng /
Lập luận / Vận dụng / Trình bày / Đọc đề / Đã quên**. Recording an exam result
does NOT write evidence or mutate the Twin. `/be/[childId]/kiem-tra`.

## L. Privacy / Settings

`/be/[childId]/cai-dat` hub: Tài khoản / Hồ sơ con / Trường lớp / Tài khoản của
con / Giáo viên đã kết nối / Quyền chia sẻ / Quyền riêng tư & dữ liệu / Gói
dịch vụ / Xóa hồ sơ. Privacy copy states DạyZi does not train AI models on the
child's data.

## M. Real Child-Profile deletion

Migration `1758067200000`: `child_deletion_requests` (mutable state REQUESTED →
CONFIRMED → COMPLETED / CANCELLED). `deletion_jobs` (existing, append-only) is
the audit trail.

`requestChildDeletion` / `cancelChildDeletion` (reversible) /
`confirmChildDeletion` — the parent re-types the child's display name, then a
privileged transaction (`session_replication_role = replica`) **hard-deletes**
every child-scoped row across ~35 tables (append-only ledgers included) and the
`child_profiles` row itself, deletes the student login that existed only for
this child, and writes an append-only `deletion_jobs` audit row with per-table
counts. Verified: profile row GONE, 9 child tables empty, audit row survives,
wrong name refused. Not a soft-hide.

## N. EntitlementService

`@copilot/domain` `entitlements.ts`: `PLAN_ENTITLEMENTS` for **FREE / BASIC
169K / PLUS 229K (recommended) / PRO 329K**. Feature + quota gates only
(maxChildren, teacher connections, evidence analyses/month, examIntelligence,
teachingCopilot, aiInterpretation, weeklyReport). **No `aiModel` / `modelTier`
/ `effort` field** — a test asserts the entitlements blob mentions no model
term. `getEntitlements` / `setPlan` (MOCK — returns `billing:
'MOCK_NO_CHARGE'`, no card, no invoice, no gateway). `createChild` enforces
`maxChildren`. The plan **never** changes which AI model runs (routing is
driven by operation + safety — `AIModelRouter.PLAN_DOES_NOT_SELECT_MODEL`).
`/goi-dich-vu` picker states this in Vietnamese.

## O. Full-web golden-journey E2E (M8)

`@playwright/test` + chromium. `apps/web/playwright.config.ts` drives the real
Next dev server (port 3100) against the shared Postgres.
`apps/web/e2e/golden-journeys.spec.ts` — **8/8 green through a real browser**:
J1 zero-data parent · J2 school context · J3 parent invites teacher (2 browser
contexts, permission grant reflected) · J4 teacher connection + contribution ·
J5 gap repair (seeded → attention → gap detail → teaching copilot) · J6
advanced child (seeded above-grade → frontier line) · J7 student practice
(separate student login) · J8 year transition (progression engine unit +
integration tested; E2E does a live app + seed-hook check). Dev-only seed hook
`app/api/test/seed/route.ts` (hard-disabled unless `DZ_DEV_AUTH=1 &&
NODE_ENV!=='production'`). `npm run test:e2e`.

## P. Mobile — HTTP API (M9)

`apps/web/lib/server/rest.ts` + `app/api/v1/[...path]/route.ts`: thin JSON
dispatch over the **same** `createProductionApi` graph + authorization the web
uses in-process — no second backend. Auth: `Authorization: Bearer <token>` +
`X-DZ-Workspace`. ~45 routes. Smoke-verified: register → child → home
(ESTIMATED) → practice (4 items) → entitlements → teacher-endpoint-as-parent =
403.

## Q. Mobile — Expo app (M9–M11)

`apps/mobile` — Expo SDK 51 + expo-router. **Zero runtime dependency on a
workspace package** (`src/theme.ts` mirrors `@copilot/design-tokens` inlined;
`src/types.ts` hand-kept DTO subset; no `@copilot/api` / `pg`). Auth
(AsyncStorage session, role → workspace, global 401 → sign out), selected-child
context, Parent/Student/Teacher bottom navs, shared UI kit, pull-to-refresh,
`+not-found`.

Screens: welcome (login / register / teacher) · Parent Home (child switcher,
ESTIMATE context, today plan, attention → gap) · Progress (3 axes) · Practice +
Runner · Gap Detail · Teaching Copilot · **Uploads (native camera / photo
picker)** · Exams (map + result + diagnosis) · Settings (children, plan, real
deletion) · Student today / practice / progress · Teacher students (redeem
code) / permission-aware child detail.

## R. M42 — DZ_DEV_AUTH strictly non-production

`resolveAuthAdapter` picks `DevAuthAdapter` only when `DZ_DEV_AUTH === '1' &&
NODE_ENV !== 'production'`. New test `auth-workspace.test.ts` "M42": in
production the flag is ignored (→ in-memory, or supabase if configured) — never
`DevAuthAdapter`.

## S. M43 — production auth/storage config

`.env.example` documents `SUPABASE_URL` / `SUPABASE_JWT_SECRET` /
`SUPABASE_SERVICE_ROLE_KEY` (auth), `SUPABASE_STORAGE_BUCKET` / `DZ_UPLOAD_DIR`
(uploads), `DZ_LIVE_VISION` (vision). No secret is committed (verified). All
adapters resolve from env with a safe default.

## T. M44 — RLS

OD-1 stays **non-blocking and documented**. The application `authorize()` /
`can()` gate is authoritative and covered by the 30-item E2E security matrix +
the M1/M3/M7 integration tests. Postgres RLS with `auth.uid()` is deferred to a
production Supabase deployment (needs the real JWT `sub` claim in the DB
session) — not added speculatively.

## U. M46 — reasoning answers

`submitPractice`: a `reasoning` item → `verificationLevel =
'AI_CROSSCHECK_REQUIRED'`, `correct = null`. Never labelled correct or incorrect
anywhere in the UI (student result screen shows "Con đã gửi cách nghĩ").

## V. M47 — zero-data cold start (J1)

No ACTIVE enrolment → conservative Curriculum Clock estimate (grade + academic
year) drives a safe starter recommendation; `createPracticeAssignment` has a
K≤K3 zero-data fallback so "Hôm nay dạy con gì?" always has an answer. The UI
says "DạyZi đang ước tính theo tiến độ chương trình" — never faked as mastery.

## W. M48 — DTO separation

Parent / Student / Teacher responses are distinct projections built server-side.
Raw DB rows are never returned. Teacher endpoints expose band words only.
Student endpoints are child-safe by construction (`assertChildSafe`).

## X. M49 — privacy-safe analytics

`@copilot/observability` `analytics.ts`: `AnalyticsAdapter` port +
`NoopAnalyticsAdapter` (default) + `ConsoleAnalyticsAdapter` (dev) +
`safeAnalytics` wrapper. `sanitizeEvent` requires a pseudonymous `actorRef`
(hash / `anon_*`), a category from a fixed vocabulary, and numeric/enum
metadata only. It **rejects** child name, school, class, question, answer, gap
text, evidence text, email, raw ids, and free-text-looking strings (6 tests).

## Y. Migrations

19 total, all additive + reversible. This phase added 3
(`1757894400000_upload_ingestion`, `1757980800000_exam_intelligence`,
`1758067200000_entitlements_and_deletion`) — each up/down/up verified. No
destructive migration, no data-loss step.

## Z. Gates

`tsc -b` 0 errors · `typecheck:web` clean · `typecheck:mobile` clean ·
`next build` 33 routes · `eslint --max-warnings=0` clean · Playwright 8/8 ·
**vitest 628 pass / 2 skip / 0 fail** · C4/C5 regression green · 30-item E2E
security matrix green · full migration down→up cycle reversible.

---

## 18 readiness flags

| # | Flag | Value | Note |
|---|---|---|---|
| 1 | STUDENT_WEB_COMPLETE | **true** | 5 routes, child-safe, verified E2E (J7) |
| 2 | STUDENT_LINKING_COMPLETE | **true** | create / link / revoke, immediate revoke verified |
| 3 | TEACHER_WEB_COMPLETE | **true** | 5 areas, permission-aware detail |
| 4 | RELATIONSHIP_UI_COMPLETE | **true** | grouped permissions, sensitive default OFF, inbox fix |
| 5 | SCHOOL_CLASS_UI_COMPLETE | **true** | propose/enrol/privacy; class roster limited by seed data |
| 6 | EVIDENCE_UPLOAD_COMPLETE | **true** | adapters + state machine + review UI; mock vision only |
| 7 | LOW_CONFIDENCE_NEVER_VERIFIED | **true** | dropped unless confirmed; tier B/C, never A — tested |
| 8 | GAP_DETAIL_COMPLETE | **true** | + Vietnamese lifecycle labels |
| 9 | TEACHING_COPILOT_COMPLETE | **true** | coaches the parent, deterministic, no LIVE AI |
| 10 | IX_RECOMPUTE_IF_STALE_COMPLETE | **true** | version+hash guarded; fresh-skip verified |
| 11 | EXAM_INTELLIGENCE_COMPLETE | **true** | map + classified diagnosis; no evidence write |
| 12 | ENTITLEMENT_SERVICE_COMPLETE | **true** | 4 plans; MOCK billing; NO model selection — tested |
| 13 | REAL_CHILD_DELETION_COMPLETE | **true** | hard purge ~35 tables + audit; not soft-hide — tested |
| 14 | FULL_WEB_GOLDEN_E2E_COMPLETE | **true** | Playwright 8/8 through a real browser |
| 15 | MOBILE_API_COMPLETE | **true** | /api/v1 over the same graph; smoke-verified |
| 16 | MOBILE_APP_PARITY | **true (code + typecheck)** | Parent/Student/Teacher screens + camera; NOT run on a device this session |
| 17 | DEV_AUTH_FAILS_CLOSED | **true** | M42 test: prod ignores DZ_DEV_AUTH |
| 18 | NO_PAID_AI_OR_LIVE_GENERATION | **true** | mock vision default, LIVE gen OFF, no OCR spend path |

## READY_FOR_DEVICE_TESTING

**Web: yes.** `npm run dev --workspace @copilot/web` + the portable Postgres →
open `http://<LAN-IP>:3100`, register, exercise all flows. Playwright proves
the 8 journeys.

**Native: yes for Expo Go, with one manual step** — set
`apps/mobile/app.json` → `expo.extra.apiBaseUrl` to the machine's LAN IP, then
`cd apps/mobile && npm install && npx expo start`. The app has not been run on a
physical device or simulator in this session (no Expo Go / simulator available
here); it is tsc-clean and the API it depends on is smoke-verified.

## Known limits / follow-ups

- Native app not exercised on a real device this session.
- Class rosters need seeded `classrooms` linked to a school for the class-enrol
  UI to list options (directory has 51 classrooms not all school-linked).
- J4 teacher-initiated (by parent email) has no dedicated UI — the invite-code
  direction covers the relationship-security requirement.
- RLS (`auth.uid()`) deferred to a real Supabase deployment (OD-1).
- Be Vietnam Pro not bundled in the native app (system font fallback).
- Live document vision + Luna generation remain OFF (ENV_REQUIRED, opt-in).
