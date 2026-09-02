# Test trên thiết bị — iPhone / Android

Có **hai cách** test DạyZi trên điện thoại:

1. **Web app** (`apps/web`, Next.js) — mở trên Safari/Chrome điện thoại, thêm ra
   màn hình chính như PWA. Đầy đủ tính năng, không cần cài gì.
2. **App native** (`apps/mobile`, Expo) — qua **Expo Go**. Cùng thương hiệu, có
   camera thật để chụp bài của con.

Cả hai nói chuyện với **cùng một backend** (`createProductionApi` chạy trong
`apps/web`, cùng Postgres, cùng authorization). App native gọi HTTP `/api/v1/*`;
web dùng server actions.

---

## A. Web app (nhanh nhất — không cài gì)

1. Máy tính + điện thoại **cùng Wi-Fi**.
2. Trên máy tính:

   ```bash
   cd "D:/Lap trinh/Claude/Dayhoc"
   npm run dev --workspace @copilot/web
   ```

   `apps/web/.env.local` cần `DATABASE_URL` + `DZ_DEV_AUTH=1`. Windows hỏi
   Firewall → **Allow access** cho Node (mạng Private).
3. `ipconfig` → **IPv4 Address** của card Wi-Fi (ví dụ `10.16.55.71`).
4. Trên điện thoại mở `http://<IP>:3100`.
5. Share ⬆️ → *Add to Home Screen*.

Đăng nhập: tạo tài khoản mới trên màn `/welcome` (chế độ dev — email + mật khẩu,
không cần IdP thật). "Tôi là giáo viên" ở cuối màn để tạo tài khoản giáo viên.

Khác mạng: `npx localtunnel --port 3100` hoặc `cloudflared tunnel --url
http://localhost:3100`.

---

## B. App native (Expo Go)

1. Cài **Expo Go** trên điện thoại (App Store / Play Store).
2. Chạy backend (web) như mục A — nó phục vụ luôn `/api/v1`.
3. Sửa `apps/mobile/app.json` → `expo.extra.apiBaseUrl` thành
   `http://<IP-máy-tính>:3100/api/v1` (KHÔNG dùng `localhost` — điện thoại
   không hiểu). Ví dụ `http://10.16.55.71:3100/api/v1`.
4. Trên máy tính:

   ```bash
   cd "D:/Lap trinh/Claude/Dayhoc/apps/mobile"
   npm install          # lần đầu
   npx expo start
   ```

5. Quét QR bằng Expo Go (điện thoại cùng Wi-Fi).

Màn hình: bố mẹ (Hôm nay · Tiến độ · Bài tập · Tài liệu · Cài đặt), học sinh
(Hôm nay · Bài tập · Tiến bộ), giáo viên (Học sinh). Chụp bài của con ở mục
**Tài liệu** dùng camera thật.

### Giới hạn hiện tại của app native

- Dev auth (email + mật khẩu, không IdP). Production cần Supabase
  (`SUPABASE_URL` / `SUPABASE_JWT_SECRET`).
- Chưa build store binary (chỉ Expo Go / dev client).
- Font Be Vietnam Pro chưa bundle — dùng font hệ thống.
- Chưa có push notification.
- `apiBaseUrl` cấu hình tay trong `app.json` (chưa có màn nhập server).

---

## Kiểm thử tự động

- **Web golden journeys**: `npm run test:e2e` — Playwright chạy 8 hành trình
  vàng qua trình duyệt thật (cần dev server + Postgres).
- **API/engine**: `npm test` — 621 test.
