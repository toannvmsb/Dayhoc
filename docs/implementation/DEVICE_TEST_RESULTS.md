# DạyZi — device test results (live)

Filled during real-device testing. `PASS` requires physical-device confirmation
from the tester. Severity: **P0** privacy/security/data-loss/crash · **P1** core
journey broken · **P2** major defect w/ workaround · **P3** polish.

## Environment

| | |
|---|---|
| Baseline commit | `819e1e9` (SDK 54 upgrade) |
| Expo SDK | **54.0.0** (matches tester's Expo Go) — upgraded from 51 |
| Machine LAN IP | `192.168.0.194` |
| Wi-Fi network | `Zin tang 1_5G 2` (Windows profile: Public — Node inbound allowed) |
| API / web | `http://192.168.0.194:3100` — health ✅ ready ✅ (LAN-verified) |
| Metro / Expo | `exp://192.168.0.194:8081` — `hostUri 192.168.0.194:8081`, SDK 54.0.0, dev bundle HTTP 200 (6.4MB) + `expo export` iOS+Android OK |
| DB | portable PG 16, `parent_copilot`, 20 migrations applied |
| Seed | `npm run seed:pilot` — parent `phuhuynh@dayzi.seed`/`pilotpass1234`, teacher `giaovien@dayzi.seed`/`pilotpass1234`, student `hs-74471d9c@dayzi.local`/`hocsinh1234`, children *Bé Lớp 4* / *Bé Lớp 7* |

---

## Android

| Device | OS | App build | Tester | Date |
|---|---|---|---|---|
| _(pending — tester to fill)_ | _(Android __)_ | Expo Go / dev (channel `dev`) | | 2026-09-02 |

| # | Test case | Result | Observed | Sev | Fix commit |
|---|---|---|---|---|---|
| 1 | App startup (open in Expo Go) | ✅ (w/ notes) | Welcome renders; "BẢN DEV" banner shows; form validation works; API reached from device (server returned the register error). Notes: (a) no custom blue splash — **P3**; (b) register endpoint error was English "email + 8-char password required" — **P2, fixed** → Vietnamese | P2 / P3 | `b047c1d` |
| 2 | Parent login (`phuhuynh@dayzi.seed`) | 🔄 | (a) Login OK, both children listed. Red error "not a guardian of this child" — stale child selection from an earlier throwaway account (**D-04, P1, fixed**). (b) Sign-out from Settings cleared the account card but did not navigate to the login screen — user stranded (**D-05, P1, fixed**). Retest pending | P1 | `791a1d0` / `<pending>` |
| 3 | Parent Home (context = ESTIMATE, today plan) | ⏳ | | | |
| 4 | Create / select Child (switcher, 2 children) | ⏳ | | | |
| 5 | Practice (create → runner → submit → "Xong rồi!") | ⏳ | | | |
| 6 | Student access / login (create login, log in as student) | ⏳ | | | |
| 7 | Student practice (self-luyện → submit) | ⏳ | | | |
| 8 | Parent Progress updates after student work | ⏳ | | | |
| 9 | Teacher login (`giaovien@dayzi.seed`) | ⏳ | | | |
| 10 | Parent ↔ Teacher connection (invite code → approve) | ⏳ | | | |
| 11 | Permission grant / revoke (sensitive toggle reflects for teacher) | ⏳ | | | |
| 12 | School / Class (propose school, "Thêm lớp", gán con, privacy) | ⏳ | | | |
| 13 | Camera (deny permission → grant → take photo → upload) | ⏳ | | | |
| 14 | Photo-library upload | ⏳ | | | |
| 15 | Evidence confirmation (untick wrong item, fix skill, confirm) | ⏳ | | | |
| 16 | Exam / Revision (create → revision map → result → diagnosis) | ⏳ | | | |
| 17 | Settings (plan change = no payment; privacy copy) | ⏳ | | | |
| 18 | Child deletion (request → cancel; re-request → wrong name → correct name) | ⏳ | | | |
| 19 | Network / error states (airplane mode, expired session, 429) | ⏳ | | | |

Legend: ⏳ not started · 🔄 in progress · ✅ pass · ❌ fail

---

## iOS

_(prepared after Android is complete)_

---

## Defect log

| ID | Sev | Test | Description | Status |
|---|---|---|---|---|
| D-01 | P2 | 1 | `/api/v1/auth/*` returned English technical errors ("email + 8-char password required", "no account with this email") to end users | **fixed** — Vietnamese messages in `rest.ts`; verified via LAN |
| D-02 | P3 | 1 | No custom blue splash screen on native (SDK 54 moved `splash` config to the `expo-splash-screen` plugin; top-level `splash` key ignored) | open — polish batch |
| D-04 | P1 | 2 | Parent home showed "not a guardian of this child" on first login: the persisted `dz.child.v1` selection from a previously-registered throwaway account was reused without checking it belongs to the signed-in parent | **fixed** — `child.tsx` gains `reconcile(availableIds)`; `parent/home.tsx` calls it against `/children` and never uses an unknown id as `activeId`; `auth.tsx` clears `dz.child.v1` on sign-out. Mobile typecheck + 636 tests green |
| D-05 | P1 | 2 | Sign-out from Settings cleared the session but did not leave the screen — `app/index.tsx` only gates the initial launch, nothing watched the session on deep screens | **fixed** — `_layout.tsx` adds an `AuthGate` effect: when the session becomes null anywhere (sign-out or global 401), `router.replace('/welcome')`. Mobile typecheck + 636 tests green |
| D-03 | P0 (infra) | 2 | Device saw stale English + `ENV_REQUIRED` errors — cause: `next build` was run while `next dev` was live on port 3100, corrupting `apps/web/.next` (`Cannot find module './chunks/vendor-chunks/next.js'`). The dev server then served production-mode / stale code | **fixed** — killed 3100, `rm -rf apps/web/.next`, restarted `next dev` clean; auth verified over LAN. **Rule: never run `next build` while `next dev` uses the same `.next`.** |
