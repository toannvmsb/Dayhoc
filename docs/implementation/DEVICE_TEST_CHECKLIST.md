# DạyZi — device test checklist

Fill one column per physical device. **Do not mark a row pass without doing it
on a real device.** Severity: **P0** privacy/security/data-loss/crash ·
**P1** core journey broken · **P2** major defect w/ workaround · **P3** polish.
Pilot cannot proceed with an open P0 or P1.

| Device | OS | App build | Tester | Date |
|---|---|---|---|---|
| _(iPhone …)_ | | | | |
| _(Android …)_ | | | | |

---

## 0. Setup

- [ ] Backend running & reachable: `GET https://<host>/api/v1/health` → `ok`,
      `GET .../ready` → `ready`
- [ ] `npm run seed:pilot` run against the staging DB (accounts below)
- [ ] **Web**: phone browser → `http://<LAN-IP>:3100` (dev) or the staging URL →
      Add to Home Screen
- [ ] **Native**: `apps/mobile/.env` → `DZ_ENV=dev`, `EXPO_PUBLIC_DEV_HOST=<LAN-IP>`
      (or `EXPO_PUBLIC_API_BASE_URL=https://staging.dayzi.vn/api/v1`) →
      `cd apps/mobile && npm install && npx expo start` → scan QR in Expo Go
- [ ] Staging/dev banner visible in the native app

**Seed accounts** (`npm run seed:pilot`):
`phuhuynh@dayzi.seed` / `pilotpass1234` ·
`giaovien@dayzi.seed` / `pilotpass1234` ·
student `hs-…@dayzi.local` / `hocsinh1234` (get the exact email from the seed output or Settings → Tài khoản của con)

---

## A. Parent journey

| # | Step | Expected | iOS | Android | Sev |
|---|---|---|---|---|---|
| A1 | Register a brand-new parent | lands on onboarding | | | P1 |
| A2 | Create Child (grade 4) | lands on Home | | | P1 |
| A3 | Home | "Hôm nay dạy con gì?", context shown as **ESTIMATE** (not fact), a today plan | | | P1 |
| A4 | Create practice (15′) → runner | 4 items, answer each, submit → "Xong rồi!" | | | P1 |
| A5 | Progress | 3 separate axes, no single score | | | P2 |
| A6 | Login as seed parent | 2 children in the switcher | | | P1 |
| A7 | Switch child | Home reflects the other child | | | P2 |
| A8 | Gap detail (grade-4 seed child → "Cần chú ý") | why / affects / lifecycle / prescription | | | P2 |
| A9 | Teaching Copilot | coaches the PARENT (say + why), a worked example | | | P2 |

## B. Student journey

| # | Step | Expected | iOS | Android | Sev |
|---|---|---|---|---|---|
| B1 | Parent: Settings → create student login | shows `hs-…@dayzi.local` | | | P1 |
| B2 | Log out, log in as the student | lands on Học sinh → Hôm nay | | | P1 |
| B3 | Student sees ONLY student content | no gap severity / Twin / teacher / parent notes | | | **P0** |
| B4 | Student: Bài tập → Luyện 15′ → runner → submit | "Xong rồi!" | | | P1 |
| B5 | Student: Tiến bộ | friendly words, no numbers | | | P2 |
| B6 | Parent: Progress after B4 | updated | | | P2 |

## C. Teacher journey

| # | Step | Expected | iOS | Android | Sev |
|---|---|---|---|---|---|
| C1 | Login as seed teacher | 1 student (Bé Lớp 7) | | | P1 |
| C2 | Open the student detail | permission list; twin/gaps visible (seed granted them) | | | P1 |
| C3 | Cập nhật học tập → send "Bài đang dạy" | success | | | P2 |
| C4 | Teacher sees no hidden fields | no raw scores / evidence text | | | **P0** |

## D. Relationship + permissions

| # | Step | Expected | iOS | Android | Sev |
|---|---|---|---|---|---|
| D1 | Parent: Kết nối → Tạo mã | code shown | | | P1 |
| D2 | New teacher (2nd device/account): Nhập mã | "đang chờ phụ huynh duyệt" | | | P1 |
| D3 | Parent: Chấp thuận | teacher appears | | | P1 |
| D4 | Parent: toggle a **Nhạy cảm** permission ON → Lưu | teacher's detail now shows that section | | | P1 |
| D5 | Parent: toggle it OFF | teacher's detail hides it (server denies) | | | **P0** |
| D6 | Parent: Ngừng kết nối | teacher loses the student immediately | | | **P0** |
| D7 | Parent: Tài khoản của con → Thu hồi | student login stops working immediately | | | **P0** |

## E. School / class

| # | Step | Expected | iOS | Android | Sev |
|---|---|---|---|---|---|
| E1 | Trường & lớp → search / "Không tìm thấy? → Đề xuất trường" | school attached | | | P2 |
| E2 | "Thêm lớp" (e.g. 7A2) → gán con, PRIMARY, chế độ chia sẻ | class attached, privacy shown in Vietnamese | | | P2 |
| E3 | Change a class privacy mode | saved; downgrading LINKED_SHARED revokes class-derived grants | | | P1 |

## F. Camera / upload (high priority)

| # | Step | Expected | iOS | Android | Sev |
|---|---|---|---|---|---|
| F1 | Tài liệu → Chụp ảnh, **deny** camera permission | clear message, no crash | | | P1 |
| F2 | Grant permission → take photo (portrait) → upload | processing state, then "Cần bạn xác nhận" | | | P1 |
| F3 | Landscape photo | handled | | | P2 |
| F4 | Large image (full-res) | uploads or a clear "file quá lớn", never a silent hang | | | P1 |
| F5 | Chọn từ thư viện | works | | | P1 |
| F6 | Kill network mid-upload | clear error + retry, no duplicate on retry | | | P1 |
| F7 | Background the app during processing, return | state consistent | | | P2 |
| F8 | Review screen: untick a wrong item, fix a skill, confirm | only ticked items recorded; low-confidence NOT auto-verified | | | **P0** |
| F9 | HEIC (iOS) | uploads or converts | | | P2 |

## G. Exam / revision

| # | Step | Expected | iOS | Android | Sev |
|---|---|---|---|---|---|
| G1 | Kiểm tra → create (date + môn) | revision map with priorities | | | P2 |
| G2 | Nhập kết quả từng phần → Xem chẩn đoán | lost-point categories in Vietnamese (Bất cẩn / Hổng kiến thức / …) | | | P2 |
| G3 | Recording a result | does NOT change the child's Twin/progress | | | P1 |

## H. Settings / privacy / plan

| # | Step | Expected | iOS | Android | Sev |
|---|---|---|---|---|---|
| H1 | Settings → change plan | instant, **no payment screen**, "không phát sinh thanh toán" | | | **P0** |
| H2 | FREE plan → try to add a 2nd child | blocked with a "nâng gói" message | | | P2 |
| H3 | Privacy copy visible | "không dùng dữ liệu để huấn luyện AI" | | | P2 |

## I. Data deletion (§21)

| # | Step | Expected | iOS | Android | Sev |
|---|---|---|---|---|---|
| I1 | Settings → Xóa hồ sơ của con | clear warning listing what is deleted | | | P1 |
| I2 | Bắt đầu quy trình xóa, then **Hủy** | child restored | | | P1 |
| I3 | Re-request, type the WRONG name, confirm | rejected | | | **P0** |
| I4 | Type the correct name, confirm | child gone from the list; student login revoked; teacher access revoked; progress/uploads/exams gone | | | **P0** |
| I5 | No single tap deletes | every path needs request → typed name → confirm | | | **P0** |

## J. Network / errors (§12–§13)

| # | Step | Expected | iOS | Android | Sev |
|---|---|---|---|---|---|
| J1 | Airplane mode → open any screen | "Không có kết nối mạng", no crash | | | P1 |
| J2 | Expire/clear the session (or wait) → any action | friendly "phiên đã hết hạn" → back to welcome | | | P1 |
| J3 | Open a deleted child (from a stale link) | 404 handled gracefully | | | P2 |
| J4 | Rapid repeated login attempts | 429 "thao tác hơi nhanh", not a lockout page | | | P2 |
| J5 | No raw backend JSON / stack trace ever shown | — | | | **P0** |

## K. UX polish (§14)

| # | Check | iOS | Android | Sev |
|---|---|---|---|---|
| K1 | Safe areas (notch, home indicator) | | | P2 |
| K2 | Keyboard does not cover the active input | | | P2 |
| K3 | Bottom nav reachable; back navigation sane | | | P2 |
| K4 | Loading + empty states on every list | | | P3 |
| K5 | Pull-to-refresh where present | | | P3 |
| K6 | Tap targets ≥ 44px | | | P3 |
| K7 | Large system text size doesn't break layout | | | P3 |

---

## Release gate (§26)

`PILOT_READY = true` only when:

- [ ] no open P0
- [ ] no open P1
- [ ] server + security test suite green (`npm test`, 628/2/0)
- [ ] `npm run build --workspace @copilot/web` green
- [ ] `npm run typecheck:mobile` green + `cd apps/mobile && npx expo export` succeeds
- [ ] this matrix passed on **≥ 1 physical iPhone** and **≥ 1 physical Android**
- [ ] camera upload (F2, F8) works on both
- [ ] Parent↔Student (B) and Parent↔Teacher permission + revoke (D5, D6, D7) work
- [ ] data deletion (I3, I4) works
- [ ] production auth config verified (`PRODUCTION_DEPLOYMENT.md` §5), `DZ_DEV_AUTH` unset
- [ ] no public Child storage URL; service role not in any client bundle
