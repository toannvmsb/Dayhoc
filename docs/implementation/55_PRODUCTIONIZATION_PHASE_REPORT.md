# 55 — Productionization & Live-Integration Phase — Báo cáo

> Phản hồi cho chỉ thị **"DẠYZI — PRODUCTIONIZATION & LIVE INTEGRATION PHASE"**
> (2026-09-04/05). Theo đúng yêu cầu: **không** thêm tính năng sản phẩm lớn,
> **không** bật paid AI/OCR toàn cục, **không** kích hoạt billing thật. Mỗi
> phase một commit riêng (xem danh sách commit ở cuối).

## Tóm tắt 1 dòng cho từng phase

| Phase | Trạng thái | Vì sao |
|---|---|---|
| P1 Production Infra | **Đã tài liệu hoá + code sẵn sàng**, chưa deploy thật | cần anh tạo Supabase project + chọn host |
| P2 Live Auth | **Adapter code xong**, chưa chạy với Supabase thật | cần `SUPABASE_URL`/`SUPABASE_JWT_SECRET` |
| P3 Live Storage | **Adapter code xong**, chưa chạy với Supabase thật | cần `SUPABASE_SERVICE_ROLE_KEY`/bucket |
| P4 Vision Benchmark | **Harness xong**, 0 case chạy | cần anh cung cấp 20-30 ảnh thật |
| P5 Live Generation | **Feature-flag + SHADOW mode đã có**, mặc định OFF | chờ Luna smoke (cần `OPENAI_API_KEY`) |
| P6 Observability | **Có sẵn từ trước** (rate-limit, health/ready, structured log) | — |
| P7 Notifications | **Adapter port xong session này**, chưa có provider thật | cần chọn vendor (Expo/FCM, Resend/SES…) |
| P8 Pilot Analytics | **Đã nối dây đầy đủ session này** (13 điểm track) | — |
| P9 Billing Readiness | **State machine + receipt adapter xong session này** | cần chọn Apple/Google + enroll dev program |
| P10 Pilot Release Gate | **Đánh giá dưới đây** | phần lớn cờ vẫn `false` — xem lý do |

---

## 1. Final commit

```
b250137 P4 (productionization): document-vision benchmark harness (no results — no dataset yet)
86be411 P9 (productionization): billing readiness — entitlement state machine + receipt validation adapter
d7da015 P7 (productionization): notification delivery adapter port
de02abc Phase P8 — pilot analytics: wire the existing privacy-safe framework
```
(4 commit riêng biệt cho 4 phase có thay đổi code thật trong phiên này; P1/P2/P3/P5/P6 không có commit mới vì đã code-complete từ trước — xem mục 2-9.)

## 2. Kiến trúc production/staging

Đã có sẵn từ trước (không viết lại session này), xác nhận còn đúng:
- `docs/implementation/PRODUCTION_DEPLOYMENT.md` — bảng đầy đủ env vars, các bước setup Supabase Auth/Postgres/Storage, HTTPS/CORS/body-size/timeout/rate-limit/health/log/error, bảng build channel dev/staging/production (mobile `DZ_ENV` + API URL), checklist pre-deploy 8 mục.
- Kiến trúc bắt buộc **Client → DạyZi API → authorize()/can() → DB/Storage/AI** — không client nào (web/mobile) nối thẳng Postgres/Storage; `services/api/src/production/production-api.ts` là điểm hội tụ duy nhất.
- `SUPABASE_SERVICE_ROLE_KEY` chỉ tồn tại phía server, không bao giờ vào bundle client (đã audit, không tìm thấy leak).
- Migrations: node-pg-migrate, 21 migration file (thêm 1 file `1758240000000_billing_readiness.js` session này), tất cả additive + có `down()`.
- Deploy thật (host nào, project Supabase nào) **chưa thực hiện** — đây là hành động cần anh tự làm (xem mục 13).

## 3. Trạng thái Supabase Auth

- `resolveAuthAdapter(env)`: `SUPABASE_URL` + `SUPABASE_JWT_SECRET` cả hai có → dùng Supabase adapter thật; `DZ_DEV_AUTH=1` + non-production → dev adapter; còn lại → in-memory.
- `assertProductionConfig()` **chặn cứng**: nếu `DZ_DEV_AUTH=1` mà set trong production → throw ngay lúc khởi động API (có test `hardening.test.ts` xác nhận).
- Code cho signup/login/refresh/logout/reset password của Parent/Teacher/Student **đã viết và test bằng adapter dev/in-memory**; **chưa test với Supabase Auth thật** vì repo không có project Supabase thật để nối vào.
- **ENV_REQUIRED còn thiếu**: `SUPABASE_URL`, `SUPABASE_JWT_SECRET`.

## 4. Trạng thái Private Storage

- `SupabaseStorageAdapter` (`packages/uploads/src/storage.ts`) code-complete: `put`/`getBytes`/`remove`, ký URL, không public.
- `resolveUploadStorageAdapter(env)` chỉ kích hoạt khi có đủ 3 biến; thiếu 1 → throw `StorageCredentialsRequiredError` (không âm thầm sai cấu hình).
- Camera upload / photo library / JPEG / HEIC / PDF / retry / xoá con / xoá upload: **luồng code đã có** (đã test device thật ở phase trước với `LocalFsUploadStorageAdapter`), **chưa test với bucket Supabase thật**.
- **ENV_REQUIRED còn thiếu**: `SUPABASE_STORAGE_BUCKET` (cộng 2 biến ở mục 3, vì cùng một Supabase project).

## 5. Công cụ Vision Benchmark

- Xây mới session này: `packages/testing/src/benchmark/vision-benchmark.ts` + `vision-benchmark-data/README.md`.
- 5 chỉ số **tách riêng** (không gộp "accuracy"): text extraction, math extraction, problem extraction, curriculum mapping, **confidence calibration** (chỉ số quan trọng nhất — phát hiện tình trạng "tự tin cao nhưng sai nhiều", đúng thứ có thể biến thành VERIFIED evidence sai nếu không chặn).
- **0 case đã chạy thật** — repo không có ảnh bài tập/kiểm tra thật nào (đúng chủ đích: ảnh thật của trẻ không bao giờ vào git — xem README trong thư mục đó).
- 14 unit test (logic chấm điểm + 2 "wiring smoke-test" chứng minh harness chạy được, **không phải** kết quả benchmark) — 100% pass.
- **Hành động cần anh**: cung cấp 20-30 ảnh bài tập/kiểm tra thật (đa dạng lớp 4 + lớp 7, cả chữ khó đọc), rồi tự tay điền `expected/*.json` (ground truth) — bước này máy không tự làm được.

## 6. Mức sẵn sàng AI Generation (Live)

- `AiGenerationMode` OFF/SHADOW/LIVE, mặc định **OFF** trừ khi set `AI_GENERATION_MODE` — đây chính là cơ chế feature-flag, không đổi.
- Luna Smoke Benchmark (5 case đại diện, guardrail `maxBatches=5`/`maxCostUsd=1`) **đã viết xong**, trạng thái hiện tại: `SMOKE_EXECUTION_STATUS = BLOCKED_MISSING_API_KEY` — không có `OPENAI_API_KEY`, **không gọi paid, không bịa kết quả**.
- Trình tự OFF → SHADOW → smoke → full benchmark → internal LIVE → pilot cohort → rollout **giữ nguyên như spec**, chưa đi quá bước SHADOW.
- **Hành động cần anh**: cấp `OPENAI_API_KEY` + **cho phép tường minh** trước khi chạy smoke (đúng quy tắc đã thống nhất từ trước, và đúng ràng buộc an toàn của tôi — tôi không tự ý chi tiêu tiền thật).

## 7. Trạng thái Observability

- Có sẵn từ trước: rate limit token-bucket theo client+route-class (`apps/web/lib/server/rate-limit.ts`), `/api/v1/health` + `/api/v1/ready`, structured logging (`@copilot/observability` `createLogger`), AI cost telemetry (`ai_usage_events`, insert-only).
- Rate limit hiện là **in-process** — cần Redis khi chạy nhiều instance (đã ghi chú trong code, chưa làm vì chưa deploy multi-instance).
- Chưa có APM/error-monitoring bên thứ 3 (Sentry/Datadog…) nối dây — đây là việc **chọn vendor + set DSN**, ngoài phạm vi "chuẩn bị kiến trúc" của phase này.

## 8. Mức sẵn sàng Notifications

- Mới session này: `NotificationDeliveryAdapter` port (`packages/revision/src/notifications.ts`) + `NoopNotificationProvider` (mặc định) + `ConsoleNotificationProvider` (dev) + `resolveNotificationProvider(env)`.
- Thêm 2 loại thông báo còn thiếu: `revision_reminder`, `relationship_request_received` — nay đủ danh sách use-case theo chỉ thị.
- **Chưa nối vào bất kỳ call site nào** (chưa có điểm gọi `.send()` thật trong `production-api.ts`) vì còn thiếu 2 thứ chỉ anh mới quyết được: (1) chọn vendor push/email thật, (2) bảng lưu device-push-token/email-preference (migration + endpoint đăng ký — một tính năng thật, ngoài phạm vi "chuẩn bị abstraction").

## 9. Trạng thái Analytics

- Mới nối dây đầy đủ session này: khung có sẵn từ trước (`@copilot/observability` `sanitizeEvent`/`safeAnalytics`, chặn tuyệt đối tên/trường/school/câu hỏi/đáp án/gap/evidence) nhưng **chưa từng được gọi ở đâu** — đã kiểm tra bằng grep, 0 kết quả trước phiên này.
- Đã gắn `.track()` ở 13 điểm: signup, child_created, parent_home_viewed, evidence_uploaded, evidence_confirmed, teaching_copilot_opened, teacher_connected, plan_created, gap_detected (chỉ khi CHUYỂN trạng thái thật, không phải mỗi lần recompute), gap_improved (tương tự), practice_started, practice_completed. Còn thiếu so với danh sách yêu cầu: `day_1_return`/`day_7_return`/`day_30_return` (cần một job định kỳ tính lại từ dữ liệu login, chưa xây — ghi nhận là việc còn lại).
- `resolveAnalyticsAdapter`: mặc định Noop kể cả production; `DZ_ANALYTICS=console` bật log dev. **Chưa có backend thật** (PostHog/Amplitude…) — cần anh chọn vendor.

## 10. Mức sẵn sàng Billing

- Mới session này: `packages/domain/src/subscription.ts` — state machine thuần (`SubscriptionStatus` +`grace_period`/`expired`, `applyBillingEvent`, `isEntitled`) + package mới `@copilot/billing` (`ReceiptValidationAdapter` port, Apple/Google adapter throw nếu thiếu credential, `MockReceiptValidationAdapter` cho dev/test, webhook-idempotency helper) + migration `billing_readiness` (cột mới + bảng `billing_webhook_events`) + `restorePurchase` nối đầy đủ end-to-end trong `production-api.ts`.
- **Không có charge thật nào** — `restorePurchase` chỉ đọc lại một giao dịch người dùng đã mua sẵn trong App Store/Play Store; Apple/Google adapter thật ném lỗi ngay vì chưa cấu hình.
- Entitlement vẫn server-authoritative 100%; plan **không bao giờ** chọn AI model (bất biến không đổi).
- **Hành động cần anh**: đăng ký Apple Developer Program + Google Play Console (tôi không được phép tạo tài khoản/nhập thông tin thanh toán thay anh), quyết định vendor, sau đó mới viết integration thật cho `AppleReceiptValidationAdapter`/`GooglePlayReceiptValidationAdapter` + route webhook có xác thực chữ ký.

## 11. ENV_REQUIRED còn thiếu (đầy đủ)

```
SUPABASE_URL
SUPABASE_JWT_SECRET
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
OPENAI_API_KEY                 # cho Luna smoke + (sau này) OCR/Vision thật
DZ_LIVE_VISION=1                # bật OpenAI vision thật, hiện KHÔNG set
AI_GENERATION_MODE=SHADOW|LIVE  # hiện KHÔNG set → mặc định OFF
RUN_LIVE_AI_BENCHMARK=1         # chỉ khi anh cho phép chạy smoke tốn phí
DZ_BILLING=mock|live            # mock để dev/test luồng restore-purchase; live cần đủ credential Apple+Google
DZ_NOTIFICATIONS=console        # tuỳ chọn, dev only — production vẫn cần chọn vendor thật trước khi có giá trị "live"
DZ_ANALYTICS=console            # tuỳ chọn, dev only — production cần vendor thật (PostHog/Amplitude…)
APPLE_ISSUER_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY / APPLE_BUNDLE_ID          # billing Apple thật
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON / GOOGLE_PLAY_PACKAGE_NAME                   # billing Google thật
```

## 12. Hành động thủ công còn lại (chỉ anh làm được)

1. Tạo Supabase project (Auth + Postgres + Storage), lấy URL/JWT secret/service role key/bucket.
2. Chọn host để deploy web + services/api (Vercel/Render/Fly/VPS…) — tôi không tự deploy thay.
3. Cung cấp `OPENAI_API_KEY` + xác nhận tường minh trước khi chạy Luna smoke benchmark (tốn phí thật) hoặc bật vision thật.
4. Cung cấp 20-30 ảnh bài tập/kiểm tra thật + tự tay điền ground truth cho Vision Benchmark.
5. Đăng ký Apple Developer Program + Google Play Console, quyết định có triển khai billing thật hay chưa.
6. Chọn vendor cho push notification (Expo/FCM) + email giao dịch (Resend/SendGrid/SES) và vendor analytics (PostHog/Amplitude…).
7. Quyết định APM/error-monitoring vendor (Sentry hay khác) nếu muốn có trước pilot.

## 13. Rủi ro P0/P1 còn tồn đọng

**Không có P0/P1 mới phát sinh từ phase này.** Rủi ro đã biết từ trước, không đổi:
- `DEVICE_TEST_REQUIRED` theo báo cáo pilot-hardening trước đó vẫn còn giá trị tham khảo (đã test cả Android/iOS thật ở phase trước phiên này, không lặp lại ở đây).
- `familyPlan` trước đây gate cứng theo `status='active'`, sẽ **sai** một khi `grace_period` từng được sinh ra bởi luồng billing thật (family bị mất quyền lợi sớm). Đã sửa trong phiên này (`isEntitled()` thay cho check `status='active'` trực tiếp) — không còn là rủi ro, ghi lại để anh biết đã có lúc tồn tại.

## 14. Cấu hình pilot cohort đề xuất đầu tiên

- **STAGING trước, không LIVE ngay**: bật Supabase Auth + Storage thật cho một nhóm nội bộ nhỏ (2-3 gia đình test nội bộ, không phải phụ huynh thật) trước.
- AI generation: giữ **OFF** cho tới khi Luna smoke pass; ngay cả sau đó, bắt đầu ở **SHADOW** (sinh nhưng không hiển thị) trước khi cho bất kỳ pilot user nào thấy.
- Vision/OCR: giữ Mock cho tới khi benchmark có ít nhất ~20 ảnh thật và đạt ngưỡng ở cả 5 chỉ số, đặc biệt confidence-calibration.
- Billing: giữ MOCK hoàn toàn cho pilot đầu tiên — không có lý do phải bật billing thật trước khi có traction.
- Notification: `console` (dev) hoặc tắt hẳn cho tới khi chọn vendor — không gửi gì ra ngoài overrides mặc định `Noop` cho users thật.

## 15. Khuyến nghị tổng thể

Tech-debt của 4 phase P4/P7/P8/P9 mà tôi vừa hoàn thành là "khung sẵn sàng, không có gì thật chạy" — đúng như chỉ thị yêu cầu. Việc lớn nhất còn lại **không phải code** mà là các quyết định + hành động thủ công ở mục 12. Đề xuất thứ tự anh nên làm trước: (1) Supabase project → (2) deploy STAGING → (3) test Parent/Teacher/Student journey trên STAGING thật → (4) mới tính đến OPENAI_API_KEY cho Luna smoke + Vision benchmark → billing/notification vendor có thể để sau, không chặn pilot kỹ thuật.

---

## Cờ trạng thái (FLAGS)

```
STAGING_READY=false                 # code sẵn sàng, chưa có Supabase project + host thật để chạy
PRODUCTION_INFRA_READY=false        # kiến trúc/docs sẵn sàng, chưa deploy thật lần nào
LIVE_AUTH_READY=false                # adapter code xong, chưa test với Supabase Auth thật
LIVE_STORAGE_READY=false             # adapter code xong, chưa test với Supabase Storage thật
VISION_BENCHMARK_READY=false         # harness xong, 0 case thật đã chạy (không có ảnh)
AI_GENERATION_SHADOW_READY=false     # cơ chế SHADOW đã có, nhưng Luna smoke vẫn BLOCKED_MISSING_API_KEY
OBSERVABILITY_READY=true             # rate-limit/health/ready/structured-log/cost-telemetry đã có và đã test — phần còn thiếu (APM vendor, Redis rate-limit) không chặn dev/staging nhỏ
PILOT_ANALYTICS_READY=false          # đã nối 13/16 event, thiếu day_1/7/30 return + chưa chọn vendor thật
BILLING_ARCHITECTURE_READY=true      # kiến trúc/entitlement/state machine/adapter port đã sẵn sàng và có test — ĐÂY LÀ "kiến trúc sẵn sàng", KHÔNG phải "billing thật sẵn sàng" (vẫn chưa chọn vendor, chưa có credential, không có charge nào có thể xảy ra)
PILOT_TECH_READY=false               # phụ thuộc STAGING_READY + LIVE_AUTH_READY + LIVE_STORAGE_READY vẫn false
```

**Tổng kết**: 2/10 cờ `true` (OBSERVABILITY_READY, BILLING_ARCHITECTURE_READY — cả hai đúng nghĩa "kiến trúc/khung sẵn sàng", không phải "đã live"). 8/10 cờ còn `false`, đa số chặn bởi hành động thủ công của anh (tạo Supabase project, chọn host, cấp OPENAI_API_KEY, cung cấp ảnh thật, đăng ký Apple/Google dev program) chứ không phải thiếu code.
