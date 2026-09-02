# DạyZi — device test results (live)

Filled during real-device testing. `PASS` requires physical-device confirmation
from the tester. Severity: **P0** privacy/security/data-loss/crash · **P1** core
journey broken · **P2** major defect w/ workaround · **P3** polish.

## Environment

| | |
|---|---|
| Baseline commit | `806bf5c` (+ fixes below) |
| Machine LAN IP | `192.168.0.194` |
| Wi-Fi network | `Zin tang 1_5G 2` (Windows profile: Public — Node inbound allowed) |
| API / web | `http://192.168.0.194:3100` — health ✅ ready ✅ (LAN-verified) |
| Metro / Expo | `exp://192.168.0.194:8081` — `hostUri 192.168.0.194:8081`, Android dev bundle builds (999 modules) |
| DB | portable PG 16, `parent_copilot`, 20 migrations applied |
| Seed | `npm run seed:pilot` — parent `phuhuynh@dayzi.seed`/`pilotpass1234`, teacher `giaovien@dayzi.seed`/`pilotpass1234`, student `hs-74471d9c@dayzi.local`/`hocsinh1234`, children *Bé Lớp 4* / *Bé Lớp 7* |

---

## Android

| Device | OS | App build | Tester | Date |
|---|---|---|---|---|
| _(pending — tester to fill)_ | _(Android __)_ | Expo Go / dev (channel `dev`) | | 2026-09-02 |

| # | Test case | Result | Observed | Sev | Fix commit |
|---|---|---|---|---|---|
| 1 | App startup (open in Expo Go) | ⏳ | | | |
| 2 | Parent login (`phuhuynh@dayzi.seed`) | ⏳ | | | |
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

_(none yet)_
