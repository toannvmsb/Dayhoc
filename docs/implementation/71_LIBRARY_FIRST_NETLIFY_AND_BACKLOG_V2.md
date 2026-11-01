# 71 — Review lại hướng sản phẩm: "Thư viện trước", Netlify test, Backlog V2

> Ngày: 2026-11-01. Thay thế định hướng **AI_GENERATION_FIRST** (doc 14/15) bằng
> **LIBRARY_FIRST**. Doc 14/15 vẫn đúng cho phần AI bổ sung; chỉ đổi *nguồn mặc định*.

## 1. Vì sao tốn token (nguyên nhân gốc)

| # | Hiện tượng | Nguyên nhân trong code |
|---|---|---|
| 1 | Mỗi con tốn tiền mỗi ngày dù chỉ mở app | `getParentHome` gọi `maybeEnqueueLiveWorksheet` → xếp 1 job **sinh AI + kiểm chéo AI** cho mỗi con mỗi ngày khi `AI_GENERATION_MODE=LIVE` |
| 2 | Chi phí nhân lên khi test | Mỗi worksheet = nhiều lần gọi model (sinh + retry + crosscheck). Trần $2/ngày chỉ là *phanh*, không phải thiết kế |
| 3 | Thư viện bị bỏ phí | Ngân hàng chỉ có 29 câu nên AI là cách duy nhất — **nay đã có 9.404 câu / 94 kỹ năng** (mỗi kỹ năng ≥ 100 câu, đáp án đã có sẵn, không cần kiểm chứng lại) |

Kết luận: với kho 9.400 câu + luật chống lặp (60 ngày/cooldown theo cấu trúc), phần lớn
nhu cầu hằng ngày của lớp 4/7 **không cần AI**. AI chỉ đáng tiền cho phần thư viện không phủ được.

## 2. Kiến trúc mới

```
Hôm nay (bố mẹ/con mở)
   └─ ensureTodayPractice
        ├─ có bài AI đã sinh sẵn?  → phát (miễn phí, đã trả tiền rồi)
        ├─ LIBRARY_FIRST (mặc định) → 1 bài thư viện/ngày/con, 0 đồng AI
        ├─ AI_TOPUP                 → như trên; AI chỉ khi thư viện không đủ 4 câu,
        │                             tối đa PRACTICE_AI_MONTHLY_CAP (mặc định 3) / con / 30 ngày
        └─ AI_FIRST                 → hành vi cũ (1 job AI/ngày) — chỉ để thử nghiệm
```

* Biến môi trường: `PRACTICE_SOURCE` = `LIBRARY_FIRST` (mặc định nếu để trống) | `AI_TOPUP` | `AI_FIRST`.
* Bài thư viện: chọn theo mức thành thạo của con (nhóm "làm được" lấy K cao nhất con đã đạt,
  nhóm "thử thách" lấy K kế tiếp, xếp dễ → khó), chống lặp theo từng con (`questions.semantic.json`).
* Mỗi ngày tối đa 1 bài tự tạo/con; nếu con còn ≥ 3 bài chưa làm thì không tạo thêm. Bố mẹ vẫn
  bấm "Tạo bài luyện tập" / "Giao con luyện phần này" khi muốn thêm.
* Khóa advisory theo (con, ngày) → hai lần mở app cùng lúc không tạo trùng.
* Các nguồn tốn tiền khác đã kiểm: OCR ảnh (mock trừ khi `DZ_LIVE_VISION=1`), kiểm chéo AI
  (chỉ chạy trong worker AI), SHADOW (mặc định OFF). Không còn đường nào tự gọi AI khi chỉ xem màn hình.

## 3. Netlify (môi trường test nhanh)

Thêm `netlify.toml` + script `build:netlify`. Đã chạy `netlify build --offline --filter @copilot/web`
trên máy: **build xong, đóng gói được hàm server Next.js** (chưa deploy vì cần tài khoản của anh).

Vì sao hợp: chế độ LIBRARY_FIRST **không cần worker / queue / cron** nên chạy được trên serverless.

Biến môi trường cần đặt trên Netlify:

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | URI Supabase (nên dùng *Transaction pooler*, cổng 6543) |
| `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | từ Supabase → Project Settings → API |
| `DZ_DB_POOL_MAX` | `2` (mỗi instance serverless giữ pool nhỏ) |
| `PRACTICE_SOURCE` | `LIBRARY_FIRST` |
| `AI_GENERATION_MODE`, `AI_CROSSCHECK_MODE` | `OFF` |

Hạn chế cần biết: upload ảnh bài tập cần Supabase Storage (`SUPABASE_STORAGE_BUCKET`) vì
hệ thống file của Netlify là chỉ-đọc; cron an toàn/dọn dẹp (`pilot-cron-*`) chưa chuyển sang
Netlify Scheduled Functions (không cần khi AI tắt).

**Việc chặn cần anh làm:** cả 2 project Supabase (staging + pilot) hiện trả lỗi
`tenant/user not found` — thường là project bị *pause* (gói free tự pause sau ~1 tuần không dùng).
Vào Supabase Dashboard → *Restore project* (hoặc tạo project mới rồi chạy `npm run db:migrate`).
Railway cũ cũng đang chết vì lý do này.

## 4. Đối chiếu với đặc tả gốc của anh (§1 User & Authentication Model)

| Chức năng | Tình trạng | Ghi chú |
|---|---|---|
| **Parent** tạo/quản lý hồ sơ con | ✅ | `/onboarding`, `/be/:id/ho-so` |
| liên kết/tách trường–lớp | ✅ | `/be/:id/truong-lop` |
| mời giáo viên · chấp thuận/từ chối · quyền GV | ✅ | `/be/:id/ket-noi` (quyền theo phạm vi) |
| upload bài tập/kiểm tra | 🟡 | chạy, nhưng OCR mặc định là **mock**; chưa có dữ liệu ảnh thật để đo |
| Learning Twin / Gap / Frontier / tiến độ | ✅ | `/be/:id/tien-do`, `/diem-can-cai-thien/:gapId` |
| "Hôm nay dạy con gì?" | ✅ | nay **tự có bài mỗi ngày từ thư viện** |
| giao bài & xem kết quả | ✅ | con thấy đúng/sai từng câu; bố mẹ giao thêm theo điểm yếu |
| **quản lý mục tiêu học** | ❌ | chưa có màn riêng (mới có "mức mục tiêu" trong báo cáo) → B2-03 |
| quản lý privacy/consent | ✅ | màn consent + xuất dữ liệu + xoá (B3-03) |
| **Student**: đăng nhập riêng, bài hôm nay/ôn tập/thử thách, hint, feedback | ✅ | username do bố mẹ đặt |
| Student tham gia classroom | ✅ | mã lớp + bố mẹ duyệt (B3-02) |
| Student không thấy analytics của bố mẹ | ✅ | child-safe projection 3 lớp |
| **Teacher**: hồ sơ độc lập, gắn trường/lớp/môn | ✅ | `/giao-vien/*` |
| GV gửi/nhận yêu cầu kết nối | ✅ | |
| GV nhập tiến độ bài/BTVN/kiểm tra theo quyền | ✅ | `cap-nhat` (đã sửa chọn bài + gửi thật) |
| GV chỉ thấy dữ liệu trong phạm vi | ✅ | không thấy Twin/Gap |

Đặc tả gốc **không cần đổi** về chức năng; chỉ đổi cách *cấp bài* (xem §2) và thứ tự ưu tiên.

## 5. Backlog V2 (xếp theo ưu tiên)

**P0 — chặn việc test**
* ✅ B0-01 Supabase staging đã khôi phục; site Netlify `daykenhoc` chạy, `/api/v1/ready` = up (2026-11-01). Kết nối DB giữ kiểm tra TLS qua biến `DB_SSL_CA`.
* ✅ B0-02 Push + Netlify build từ repo (Git-based deploy).
* ✅ B0-03 Test `worksheet-job-queue.integration` (bounded retry) không còn enqueue mode `OFF` sai ràng buộc.

**P1 — chất lượng nội dung (thư viện là nguồn chính)**
* B1-01 Rà chất lượng mẫu: lấy ngẫu nhiên ~30 câu/kỹ năng để giáo viên kiểm (đúng đáp án, đúng lớp).
  Hiện toàn bộ 9.400 câu ghi `origin: authored`; nếu do máy sinh thì đánh dấu lại.
* B1-02 Bổ sung câu **T4–T5/HSG** (hiện thư viện chỉ có ~3% ở mức K3/T4–K4/T4; 7 kỹ năng chưa có câu K1).
* B1-03 90% câu ở mức rủi ro lặp CAO (cooldown 21 ngày) → thêm biến thể cấu trúc để vòng lặp dài hơn.
* ✅ B1-04 Bài **ôn thi tháng/học kỳ** từ thư viện: nút "Giao đề ôn thử" ở trang kỳ thi → 1 bài `REVISION` ghép theo phạm vi thi, nhiều câu hơn ở kỹ năng ưu tiên cao, dễ→khó, 0 AI. Chưa có: bảng chấm điểm tự động theo đề thi thật, liên kết bài ↔ kỳ thi trong DB (cần migration `assignments.exam_id`).
* ✅ B1-05 Log chọn bài theo từng câu phát cho con + liên kết bài ôn thi ↔ kỳ thi (`assignments.exam_id`).

**P2 — đúng mục tiêu "bố mẹ không phải làm gì nhiều"**
* ✅ (code) B2-01 Đọc ảnh bài tập bằng AI thật: tắt mặc định (`DZ_LIVE_VISION=1` + `OPENAI_API_KEY`), cần consent `document_reading`, trần/ngày theo con & toàn hệ thống, kết quả AI được kiểm schema + allow-list kỹ năng, mọi lần gọi ghi `ai_usage_events`. **Còn:** chạy `node scripts/run-vision-benchmark.mjs --live --max=3` với key thật để đo chi phí/ảnh; nối `minimizeForProvider()` cho đường ảnh gốc.
* ✅ B2-02 Số phút học/ngày do bố mẹ chọn (10–60′, màn `/be/:id/muc-tieu`) → độ dài bài tự tạo hằng ngày.
* ✅ B2-03 Màn **mục tiêu học**: Giữ nhịp / Củng cố nền / Nâng cao-HSG (+ cờ "sắp thi") → đổi tỉ lệ bài vừa sức : thử thách (75:25 · 85:15 · 60:40). Lưu ở `child_profiles.goals` (không cần migration).
* ✅ B2-04 Nhắc bố mẹ khi con chưa làm bài 2 ngày (banner trong app + email/push nếu đã cấu hình kênh; tối đa 3 lần/đợt, bố mẹ tắt được). Cần cron gọi `POST /admin/reminders/run` → B3-04.
* ✅ B2-05 Ngày tính theo giờ Việt Nam (UTC+7) cho bài hằng ngày, bài miễn phí 1 lần/ngày, báo cáo tuần.

**P3 — mở rộng**
* B3-01 AI_TOPUP bật thử cho 1–2 gia đình sau khi có số đo chi phí/ngày thật.
* ✅ B3-02 Học sinh nhập mã lớp của giáo viên → bố mẹ duyệt (mã không tự ghi danh).
* ✅ B3-03 Màn quản lý consent + xuất dữ liệu của con (JSON).
* B3-04 Cron an toàn/dọn dẹp trên Netlify Scheduled Functions (chỉ khi bật AI).
* B3-05 App mobile (Expo) — để sau khi web ổn.

## 6. Số liệu chi phí (để ra quyết định)

* Chế độ mặc định mới: **0 USD AI/ngày/con**.
* Cũ (AI_FIRST): ~$0.01–0.07 / worksheet (doc 64), nhân số con × số ngày × retry; trần $2/ngày/cohort.
* Nếu bật AI_TOPUP: tối đa 3 worksheet AI / con / 30 ngày (đổi bằng `PRACTICE_AI_MONTHLY_CAP`).
