# DạyZi — DEVICE TESTING & PILOT HARDENING report

Baseline: `main @ ca3df82` (628 pass). End state after this phase:
**20 migrations, 636 test / 2 skip / 0 fail**, tsc + web/mobile typecheck +
`next build` + Playwright 8/8 + eslint green, **`expo export` produces the iOS
and Android bundles**.

No architecture redesign. No new major feature.

---

## 1. Final commit / commits

| Commit | Scope |
|---|---|
| `3378dc0` | mobile runtime config + standalone build (bundle proven) |
| `<this>` | API hardening, RLS, pilot seed, class-creation UX, docs, report |

## 2. Production config changes

- `assertProductionConfig()` in `apps/web/lib/server/api.ts` — `getApi()` throws
  on first use if `NODE_ENV=production` and: `DZ_DEV_AUTH=1` is set, or
  `DATABASE_URL` / `SUPABASE_URL` / `SUPABASE_JWT_SECRET` missing. `getApi()`
  also throws if the resolved auth adapter is not `supabase` in production.
- `.env.example` + `apps/mobile/.env.example` document every variable.
- `docs/implementation/PRODUCTION_DEPLOYMENT.md` — env table, Supabase
  auth/postgres/storage setup, HTTP/infra settings, build channels,
  pre-deploy checklist.

## 3. Mobile runtime changes

- **`apps/mobile` removed from the workspace** → private `node_modules` +
  lockfile. npm-workspaces hoisting was silently dropping the nested
  `expo-router` transitive tree (`schema-utils`, `@radix-ui/react-slot`,
  `warn-once`, …) so Metro could not bundle. Standalone install fixes it;
  `expo export` now succeeds for iOS **and** Android (2.18 MB Hermes bundle,
  867 modules).
- `app.config.ts` (dynamic): `DZ_ENV` = dev | staging | production;
  `EXPO_PUBLIC_API_BASE_URL` override; `EXPO_PUBLIC_DEV_HOST` for a LAN IP in
  dev. **No hardcoded IP in source.** Build-time guard THROWS if a production
  build resolves a non-HTTPS or LAN API URL (verified: `http://10.0.0.5/…` →
  build error). Staging/dev builds carry a channel banner + a distinct bundle
  id / app name.
- `src/config.ts` — runtime validation with fail-fast Vietnamese messages;
  `_layout.tsx` renders a config-error screen instead of making broken calls.
- `src/store.ts` — bearer token in `expo-secure-store` (keychain / keystore) on
  native; `localStorage` fallback on web. Non-secret prefs in AsyncStorage.
- `src/auth.tsx` — re-validates the token on launch (`whoami`); global 401 →
  sign out; multi-role identities get a **Workspace switcher** (Settings /
  Student progress / Teacher home).
- `src/api.ts` — 20s timeout with abort; `OfflineError` on network failure;
  `ApiError.friendly` maps 401/403/404/409/413/429/5xx/offline to Vietnamese.
- Be Vietnam Pro bundled (`@expo-google-fonts`, OFL); splash held until loaded;
  system font fallback.
- `KeyboardAvoidingView` + `keyboardShouldPersistTaps` on every Screen;
  pull-to-refresh; `+not-found`.
- `metro.config.js` reduced to `getDefaultConfig(__dirname)` (standalone).

## 4. RLS decision

`docs/implementation/RLS_DECISION.md`. All production data access is
server-mediated — no client touches Postgres. Migration
`1758153600000_rls_deny_by_default` turns **RLS ON with no policies (deny-all)**
for ~55 personal / child / consent / audit tables. The app connects with a
`BYPASSRLS` role so behaviour is unchanged (verified: practice-loop integration
still green); a leaked non-privileged credential reads nothing. Reference tables
(schools, subjects, calendars, pricing) left readable. No speculative
`auth.uid()` policies — the `authorize()` / `can()` layer stays authoritative.

## 5. Storage configuration

- `UploadStorageAdapter`: `LocalFsUploadStorageAdapter` (dev, `DZ_UPLOAD_DIR`) /
  `SupabaseStorageAdapter` (prod — `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  + `SUPABASE_STORAGE_BUCKET`, **private bucket**, server-mediated read/write,
  keys `child/<childId>/<uuid>-<file>` with no PII).
- Service role key is server-only — never in a web or mobile bundle (verified
  `git grep` clean; the mobile app imports no server code).
- No public Child upload URL. 30-day retention (privacy architecture) — wire a
  storage lifecycle rule / cron in production.

## 6. Supabase readiness

Documented (`PRODUCTION_DEPLOYMENT.md` §2): Email auth provider, URL / redirect
config incl. the `dayzi://` deep link, JWT secret → `SUPABASE_JWT_SECRET` (app
verifies HS256 itself, does not use the anon key), service role for
register/storage only, direct-connection `postgres` role for `DATABASE_URL`.
Not executed here — **needs a real Supabase project** (ENV_REQUIRED).

## 7. Seed tooling

`scripts/seed-pilot.mjs` (`npm run seed:pilot` / `seed:pilot:reset`).
Idempotent, refuses `NODE_ENV=production`, all emails `@dayzi.seed`. Creates:
parent (PLUS), grade-4 + grade-7 child, student login, teacher, school + active
year + **PRIMARY class + HSG_TEAM class** (fixes the class-roster seed gap),
accepted teacher relationship with sensitive grants, sample failing evidence →
a real gap, a practice assignment, a scheduled exam. Verified: create,
re-run (same childIds), `--reset` (clean).

Also — **class creation is now in the product**: `Trường & lớp` → "Thêm lớp"
(`proposeClassAction` → `proposeClass`), so a pilot family does not depend on
seeded classrooms or manual DB edits (PD-1 style resolution of §16).

## 8. Device test checklist

`docs/implementation/DEVICE_TEST_CHECKLIST.md` — setup (web + Expo Go), seed
accounts, and a checkbox matrix per physical device: Parent (A1–A9), Student
(B1–B6, incl. the **child-safety P0**), Teacher (C1–C4), Relationship +
permission revoke (D1–D7, four **P0s**), School/class (E1–E3), **Camera/upload
(F1–F9)**, Exam (G1–G3), Settings/plan (H1–H3), **Data deletion (I1–I5)**,
Network/errors (J1–J5), UX polish (K1–K7), plus the release gate (§26).

## 9. API deployment hardening

`apps/web/app/api/v1/[...path]/route.ts` + `lib/server/rate-limit.ts`:

- **request id** on every response (`x-request-id`)
- **rate limiting** — in-process token bucket per `client(IP + bearer fp) +
  route-class`: auth 10/min, invite 8/min, lookup 20/min, upload 12/min,
  practice 20/min, write 60/min, read 240/min (verified: 10× register → 200,
  11th → 429 + `retry-after`). Swap the `Map` for Redis for multi-instance.
- **16 MB body cap** → 413
- **structured one-line log** per request: `reqId, method, route (ids masked as
  :id), status, ms, rule, err`. NO child name / question / answer / gap /
  evidence / token.
- **error mapping**: 5xx → generic Vietnamese line, **never a stack trace**;
  4xx → the domain message (already user-safe).
- `GET /api/v1/health` (liveness) · `GET /api/v1/ready` (DB ping → 503 when down)

## 10. Device runtime results

**No physical device or simulator is available in this environment.**
Per the phase rules everything up to the device is complete; the physical-device
steps remain.

| What | Evidence |
|---|---|
| Mobile JS bundle builds | `expo export` → iOS + Android Hermes bundles (867 modules) |
| Mobile typecheck | `tsc --noEmit` clean |
| API the app calls | smoke-verified: register → child → home → practice(4) → entitlements → 403 on cross-workspace; health/ready/rate-limit verified via curl |
| Web app runtime | Playwright 8/8 golden journeys through a real browser |
| Config guard | production build with a LAN URL → build fails (verified) |

## 11. iOS result

`IOS_DEVICE_TESTED = false` — bundle builds; not run on an iPhone. Steps A–K in
the checklist remain.

## 12. Android result

`ANDROID_DEVICE_TESTED = false` — bundle builds; not run on an Android device.

## 13. Upload / camera result

`CAMERA_UPLOAD_DEVICE_TESTED = false`. Code path complete (expo-image-picker,
base64 → `/api/v1` upload → mock vision → in-app review/confirm), permission
strings in `app.config.ts`, 413 handling, offline error, no silent failure.
Checklist F1–F9 must run on a real device (this is the highest-risk area).

## 14–18. Parent / Student / Teacher / Relationship / Deletion runtime

All flows are exercised end-to-end through the **web** UI by Playwright (J1–J8)
and by the M1–M7 integration suites at the API layer (628→636 tests). On native
they are code-complete + typecheck-clean but not run on a device. Checklist
sections A / B / C / D / I cover them.

## 19. Security result

`PILOT_SECURITY_READY = true` (server side):
- 30-item E2E security matrix green; M1/M3/M7 authorization integration green
- dev auth fails closed in production (M42 test) + `getApi()` refuses a non-
  Supabase adapter in production
- deny-all RLS on all personal/child tables
- rate limiting on auth / invite / lookup / upload / practice
- no stack traces to clients; logs carry no learning content or tokens
- no secret committed; service role never in a client bundle
- real hard Child-profile deletion (not soft-hide), typed-name confirmation

## 20. Test totals

`vitest` **636 passed / 2 skipped / 0 failed** (75 files) ·
`playwright` **8 / 8** · `tsc -b` 0 errors · `typecheck:web` clean ·
`typecheck:mobile` clean · `eslint --max-warnings=0` clean ·
20 migrations (all additive, up/down/up).

## 21. Build results

- `npm run build --workspace @copilot/web` → compiled, 35 routes
- `cd apps/mobile && npx expo export` → iOS + Android bundles OK
- `npm run typecheck:mobile` (via `--prefix`) → clean

## 22. P0 / P1 / P2 / P3 issue list

No open **P0** or **P1** in the code. Remaining items:

| Sev | Item |
|---|---|
| P1 (process) | Device test matrix not executed on physical iPhone / Android — **blocks `PILOT_READY`** |
| P2 | Supabase project not provisioned (auth/storage config documented, not applied) |
| P2 | Rate limiter is per-instance (in-memory) — fine for a single-instance pilot; needs Redis to scale out |
| P3 | Upload retention pruning is a documented cron, not yet wired |
| P3 | `next` dev "Cross origin request" warning (cosmetic, Next 15 will need `allowedDevOrigins`) |

## 23. Remaining ENV_REQUIRED

- `SUPABASE_URL` / `SUPABASE_JWT_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` — real
  Supabase project for staging + production auth
- `SUPABASE_STORAGE_BUCKET` — private bucket for evidence uploads in production
- (optional, OFF) `DZ_LIVE_VISION` + `OPENAI_API_KEY` — paid document vision
- Staging / production hostnames for `app.config.ts` defaults if not
  `dayzi.vn` / `staging.dayzi.vn`

## 24. Remaining manual device actions

1. `npm run seed:pilot` against the staging DB.
2. Set `apps/mobile/.env` (`DZ_ENV`, `EXPO_PUBLIC_DEV_HOST` **or**
   `EXPO_PUBLIC_API_BASE_URL`).
3. `cd apps/mobile && npm install && npx expo start` → Expo Go on a physical
   **iPhone** and a physical **Android** (same Wi-Fi).
4. Work `DEVICE_TEST_CHECKLIST.md` sections A–K on each device; log device / OS /
   build / pass-fail / severity / screenshot refs.
5. Fix any P0/P1, re-run gates (§28), re-test.
6. Provision Supabase; verify `GET /api/v1/ready`; deploy staging web/API;
   point a `staging` mobile build at it and repeat the smoke.

---

## Final flags

| Flag | Value |
|---|---|
| `WEB_PILOT_READY` | **true** — 8/8 golden journeys through a real browser; build green; security green |
| `MOBILE_CODE_READY` | **true** — Parent/Student/Teacher screens; typecheck clean; **iOS + Android bundles build** |
| `IOS_DEVICE_TESTED` | **false** — no iPhone available this session |
| `ANDROID_DEVICE_TESTED` | **false** — no Android device available this session |
| `CAMERA_UPLOAD_DEVICE_TESTED` | **false** — code complete; must run F1–F9 on a device |
| `PRODUCTION_AUTH_CONFIG_READY` | **true (documented + guarded)** — needs a real Supabase project to apply |
| `PRODUCTION_STORAGE_CONFIG_READY` | **true (documented + adapter)** — needs a real private bucket |
| `PILOT_SECURITY_READY` | **true** — server-side (RLS, rate limit, fail-closed auth, no leaks, real deletion) |
| `DEVICE_TEST_REQUIRED` | **true** — §24 steps 1–5 remain, on physical devices |
| `PILOT_READY` | **false** — gated only on the physical-device test matrix (no code P0/P1) |
