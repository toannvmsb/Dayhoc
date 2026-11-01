# 72 — Bật AI bổ sung (B3-01): hướng dẫn từng bước

Mục tiêu: cho **1–2 gia đình thí điểm** nhận bài do AI sinh khi thư viện (9.404 câu) không đủ cho một ngày học.
Mặc định hệ thống vẫn là `LIBRARY_FIRST` (0 đồng AI). Mọi bước dưới đây đều **tắt được trong 1 phút** (mục 8).

## 0. Cơ chế & các lớp chặn chi phí

| Lớp | Giá trị | Ý nghĩa |
|---|---|---|
| `PRACTICE_SOURCE=AI_TOPUP` | — | Chỉ gọi AI khi thư viện không đủ bài cho ngày đó |
| `PRACTICE_AI_MONTHLY_CAP` | mặc định 3 | Tối đa 3 phiếu AI / bé / 30 ngày |
| `internal_live_cohort` | 1–2 gia đình | Gia đình ngoài danh sách không bao giờ gọi AI |
| `INTERNAL_LIVE_GEN_DAILY_CAP_USD` / `..._XCHECK_...` | 2.00 / 0.50 | Hết hạn mức ngày → tự hạ về SHADOW (không tốn tiền) |
| Consent phụ huynh | `ai_generated_learning_content_pilot` | Chưa đồng ý thì không phát câu AI cho bé |
| Cổng phát | READY + (đúng theo kiểm tra tất định **hoặc** cross-check PASS) | Câu chưa kiểm chứng không tới tay bé |
| Kill switch | env `AI_GENERATION_KILL_SWITCH=true` hoặc `pilot-admin kill on` | Dừng mọi lần gọi AI mới |
| Safety cron | mỗi 10 phút | Thấy tín hiệu CRITICAL → tự bật kill switch |

Vì Netlify là serverless nên **cần 1 tiến trình worker chạy liên tục** (`npm run worker:worksheet`) để xử lý hàng đợi `worksheet_jobs`.

## 1. Chuẩn bị (anh làm)

1. **OpenAI API key** từ tài khoản của anh; đặt giới hạn chi tiêu hằng tháng trong dashboard OpenAI (vd. 10 USD) — lớp chặn ngoài cùng.
2. **Nơi chạy worker** (chọn một): Render (đã có `render.yaml`), hoặc Railway/Fly dùng `Dockerfile`. Gói rẻ nhất là đủ (worker nhẹ).
3. **Một gia đình thí điểm** đã có tài khoản + hồ sơ bé trong app.
4. **Chuỗi kết nối DB cho worker**: cùng Supabase với Netlify nhưng dùng **session pooler / cổng 5432** (worker cần `FOR UPDATE SKIP LOCKED`, không dùng transaction pooler 6543).

> Không gửi key/mật khẩu cho em qua chat. Anh tự dán vào Netlify/Render.

## 2. Chạy migration (nếu chưa)

Staging còn 3 migration chưa chạy (trong đó có `bytes_purged_at`). Chạy trước khi bật:

```bash
npm run db:migrate:pilot
```

## 3. Dựng worker

**Render:** New → Blueprint → chọn repo (đọc `render.yaml`) → tạo env group `dayzi-pilot`, điền các mục `sync: false`:
`DATABASE_URL` (session pooler 5432), `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.

Các biến cố định của worker (đã có sẵn trong blueprint):

```
AI_GENERATION_MODE=LIVE
AI_CROSSCHECK_MODE=LIVE
CROSSCHECK_MODEL=gpt-4.1-mini
WORKSHEET_QUEUE=durable
AI_GENERATION_KILL_SWITCH=false
INTERNAL_LIVE_GEN_DAILY_CAP_USD=2.00
INTERNAL_LIVE_XCHECK_DAILY_CAP_USD=0.50
```

Lệnh chạy: `npm run worker:worksheet`. Log đúng: `[worksheet-worker] started (workerId=…)`.
Mã thoát **3** = cấu hình thiếu/sai (xem dòng lỗi ngay trước đó).

Chỉ cần dịch vụ **worker**; cron của Render không cần nữa vì safety và dọn dẹp đã chạy trên Netlify (mục 4).

## 4. Netlify (web)

Site settings → Environment variables, thêm:

```
PRACTICE_SOURCE=AI_TOPUP
AI_GENERATION_MODE=LIVE
WORKSHEET_QUEUE=durable
OPENAI_API_KEY=<key của anh>
INTERNAL_LIVE_GEN_DAILY_CAP_USD=2.00
INTERNAL_LIVE_XCHECK_DAILY_CAP_USD=0.50
CRON_SECRET=<chuỗi ngẫu nhiên >= 24 ký tự>   # nếu chưa đặt
```

Tuỳ chọn: `PRACTICE_AI_MONTHLY_CAP=3`. Sau đó **Deploys → Trigger deploy** (biến mới chỉ có hiệu lực sau deploy).

Safety cron: `netlify/functions/safety-cron.mjs` chạy mỗi 10 phút, gọi `POST /api/cron/safety` (cần `CRON_SECRET`). Không có việc gì bất thường thì chỉ là no-op.

Nên chạy **SHADOW trước** (đặt `AI_GENERATION_MODE=SHADOW` ở cả Netlify và worker): hệ thống sinh và ghi nhận nhưng không phát cho bé → kiểm tra chất lượng mà không rủi ro. Khi ổn đổi sang `LIVE`.

## 5. Thiết lập gia đình thí điểm (CLI)

Trong `.env` local (không commit) cần `PILOT_DATABASE_URL`. Rồi:

```bash
node scripts/pilot-admin.mjs status
node scripts/pilot-admin.mjs grant-admin toannv.msb@gmail.com
node scripts/pilot-admin.mjs add-family parent@example.com "Gia đình A"
```

**Consent:** ưu tiên để phụ huynh tự bấm đồng ý trong màn *Trung tâm quyền riêng tư*. Chỉ dùng
`node scripts/pilot-admin.mjs consent parent@example.com` khi chính phụ huynh đó đã đồng ý rõ ràng với anh (lệnh này ghi một dòng vào sổ consent thay họ). Nếu cấp consent sau khi đã có job: `requeue parent@example.com`.

## 6. Chạy thử & kiểm tra

1. Với tài khoản bé thí điểm, tạo tình huống thư viện không đủ bài (vd. mục tiêu/độ khó hiếm) → app xếp 1 phiếu AI vào hàng đợi.
2. Xem log worker: có job được claim → sinh → kiểm chứng → `READY`.
3. `node scripts/pilot-admin.mjs status` — số job, chi phí hôm nay, trạng thái kill switch.
4. `node scripts/pilot-admin.mjs safety` — quét chỉ-đọc, mong đợi không có CRITICAL.
5. Mở bài của bé: câu AI chỉ hiện khi đã READY + có consent.

Checklist hằng ngày (5 phút) xem doc 70 §9.

## 7. Theo dõi chi phí & khi nào mở rộng

- Chi phí thật: bảng `ai_usage_events` (INSERT-only) và dashboard OpenAI.
- Mức dự kiến: ≤ 3 phiếu/bé/tháng nên thường ≪ 1 USD/bé/tháng; trần ngày 2.50 USD cho cả cohort.
- Mở rộng sang gia đình thứ 3+ chỉ khi: 2 tuần không có CRITICAL, tỉ lệ câu bị loại ở cổng kiểm chứng thấp, giáo viên duyệt mẫu ngẫu nhiên ổn.

## 8. Tắt / quay lại (rollback)

| Việc | Cách |
|---|---|
| Dừng gọi AI ngay | `node scripts/pilot-admin.mjs kill on "lý do"` (hoặc `AI_GENERATION_KILL_SWITCH=true` rồi redeploy) |
| Bật lại | `node scripts/pilot-admin.mjs kill off` |
| Về chế độ không tốn AI | Netlify: `PRACTICE_SOURCE=LIBRARY_FIRST` + redeploy |
| Dừng worker | Suspend dịch vụ worker trên Render |
| Rút một gia đình | Phụ huynh rút consent trong app; câu AI ngừng được phát |

Dữ liệu đã ghi (evidence, sổ consent, ledger) là append-only và không bị ảnh hưởng khi tắt.
