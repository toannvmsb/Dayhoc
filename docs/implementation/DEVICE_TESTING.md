# Test trên thiết bị — iPhone (và Android)

Bản demo hiện tại là **web app** (`apps/web`, Next.js) — chạy được ngay trên
Safari iPhone, thêm được ra màn hình chính như một app (PWA). App native Expo/RN
là bước sau (S-03).

Dữ liệu là **giả lập nhưng chạy qua đúng engine thật** (twin → gap → planner →
projection). Chưa có đăng nhập / backend — mỗi màn hình tự dựng cảnh demo.

---

## Cách nhanh nhất: cùng Wi-Fi

1. **Máy tính và iPhone cùng một mạng Wi-Fi.**

2. Trên máy tính, chạy dev server (đã cấu hình lắng nghe mọi địa chỉ):

   ```bash
   cd "D:/Lap trinh/Claude/Dayhoc"
   npm run dev --workspace @copilot/web
   ```

   Lần đầu Windows có thể hỏi Firewall → chọn **Allow access** cho Node (mạng Private).

3. Tìm địa chỉ IP nội bộ của máy: `ipconfig` → dòng **IPv4 Address** của card Wi-Fi.
   Hiện tại máy anh là **`10.16.55.71`** (đổi nếu chuyển mạng).

4. Trên **Safari iPhone**, mở:

   ```
   http://10.16.55.71:3100
   ```

5. **Thêm ra màn hình chính** (để chạy toàn màn hình như app):
   nút Share ⬆️ → *Add to Home Screen* → tên "Học cùng con", icon chữ **H** nền xanh.
   Mở từ icon đó sẽ ẩn thanh địa chỉ Safari.

Điều hướng: thanh dưới cùng (Hôm nay · Con · Cập nhật · Tiến bộ · Thêm).
**"Thêm"** liệt kê tất cả màn hình demo.

---

## Nếu khác mạng / muốn gửi link cho người khác test

Dùng tunnel tạm (không cần deploy):

```bash
# terminal 1
npm run dev --workspace @copilot/web
# terminal 2
npx localtunnel --port 3100
```

`localtunnel` in ra một URL `https://….loca.lt` mở được từ bất kỳ đâu (nhập
password = IP công cộng của máy khi được hỏi). Hoặc `cloudflared tunnel --url
http://localhost:3100` nếu đã cài `cloudflared`.

---

## Màn hình có trong demo

| Đường dẫn | Màn hình |
|---|---|
| `/` | Hôm nay (bố mẹ) — tóm tắt con + kế hoạch hôm nay + cần chú ý |
| `/progress` | Tiến bộ — 3 trục: kiến thức · dạng bài · tư duy, có vạch mục tiêu |
| `/gap/demo` | Chi tiết một lỗ hổng — "vì sao con sai" + hướng củng cố |
| `/exam` | Ôn thi — phạm vi suy ra từ ngữ cảnh + kế hoạch ôn |
| `/weekly` | Báo cáo tuần |
| `/child` | Màn hình của Con — chỉ bài được giao, **không** có phân tích/mastery |
| `/child/do`, `/child/challenge`, `/child/result` | Con làm bài · thử thách · kết quả |
| `/teacher`, `/teacher/update` | Màn hình Giáo viên (chỉ ngữ cảnh được mời) |

---

## Giới hạn của bản web demo (sẽ có ở app thật)

- Chưa có đăng nhập, PIN, chuyển hồ sơ con → mỗi màn hình là 1 cảnh cố định.
- Chưa có scan bài / chụp ảnh (cần OCR provider — P-04, hoãn tới sau pilot).
- Chưa lưu tiến trình giữa các lần mở.
- Bàn phím nhập đáp án ở màn "Con làm bài" là bản demo, chưa chấm thật.

## Bước sau

- **App native Expo/RN** (`apps/mobile`) — test qua Expo Go, dùng chung
  `@copilot/projections` + `@copilot/design-tokens`. (S-03)
- Nối backend + auth (P-03 đã có schema) để có trạng thái thật.
