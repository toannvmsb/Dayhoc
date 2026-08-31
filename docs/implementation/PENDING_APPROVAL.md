# PENDING — cần anh duyệt / bổ sung

> Tổng hợp các điểm vướng, quyết định cần duyệt, và dữ liệu cần bổ sung phát sinh
> trong quá trình em làm autonomous các phase. **Không có mục nào trong đây chặn
> phase kế tiếp** — em đã đi vòng hoặc để lại `todo` có đánh dấu.
>
> Cập nhật lần cuối: 2026-08-31 (sau khi hoàn thành vertical slice P0–P10).
>
> **Tình trạng:** Toàn bộ 11 phase (P0→P10) đã có vertical slice + 149 test xanh.
> Deterministic engine, projections, web app (Parent/Child/Teacher/Exam/Weekly),
> API role-gated, AI adapter + audit trace đều chạy. Phần còn lại chủ yếu là
> **dữ liệu** và **quyết định của anh** — liệt kê dưới đây.

---

## A. Quyết định — ✅ ANH ĐÃ CHỐT 5/5 (2026-08-31)

| # | Quyết định của anh | Em đã làm gì |
|---|---|---|
| P-01 | **Em tự rà skill graph/DAG lớp 7 theo SGK trước → xuất bản đề xuất, anh duyệt.** Chưa freeze `M7.*`. | ⏳ TODO: em rà 42 skill + DAG + 9 bridge + 5 family HSG theo SGK Toán 7 KNTT, xuất Google Sheet cho anh. |
| P-02 | Giữ coefficients provisional tới khi có pilot data. | ✅ Đã đúng (config tách riêng, mọi output có `confidence`). |
| P-03 | **Con login = username + password do bố mẹ tạo (con đổi được). PIN 4 số = shortcut vào bài được giao, KHÔNG phải login.** | ✅ `04_DATABASE_MODEL §1`: `child_credentials` + `child_quick_access` (scope='assigned_work'). Migration `1756684800000`. CLAUDE.md role restrictions cập nhật. |
| P-04 | Chưa chốt LLM/OCR — dùng mock, quay lại sau. | ✅ Đã đúng (`@copilot/ai` MockProvider; `ai_provider_registry` seed 'internal'+'mock'). |
| P-05 | **17 nguyên tắc Privacy-by-Design → bake vào architecture trước khi build module data trẻ em.** | ✅ `docs/implementation/PRIVACY_ARCHITECTURE.md` + delta vào docs 03/04/05/06. Migration `1756684800000_privacy_foundation`: `consent_records` (⊕ versioned), `ai_provider_registry` (`training_allowed` CHECK false), `data_processing_inventory`, `deletion_jobs`, `rights_requests` (⊕), upload retention 30d. `@copilot/ai` `minimizeForProvider()` + 5 test. Consent UI = deliverable sau. |

## B. Dữ liệu — CẬP NHẬT 2026-08-31

✅ **D-01 ĐÃ NHẬN** — Math Dev Core v1.0 (52 M4 + 37 M7 skills, curriculum, prereq graphs). Đã ingest, KB có 94 skills. **Lưu ý: M7.\* IDs là `provisional_normalization`** — cần math-educator review trước khi freeze production (đây chính là P-01, giờ quan trọng hơn).
✅ **D-02 ĐÃ NHẬN** — 12 golden student profiles + 120 golden questions + 360 golden error cases + 15 curated scenarios. Đã wire vào test thật.
✅ **D-06 ĐÃ NHẬN** — Golden **Learning Twin & Planner** Dataset v1.0 (48 hồ sơ, 912 evidence event, 48 expected state, 15 curated planner scenario) + Golden **End-to-End Family Journey** Dataset v1.0 (24 family/journey, 24 checkpoint, 15 failure-recovery scenario, 15 E2E invariant). Đã vendor vào `packages/testing/golden-data/twin-planner/` + `.../e2e/` và wire vào test:
  - `golden/twin-planner.test.ts` — chạy full pipeline (Evidence→Twin→Gap→Readiness→Mix→DailyPlan) cho cả 48 hồ sơ; hard-assert 4 invariant cấu trúc (không vượt time budget · không có global grade/level · twin là projection order-independent · hinted ≤ unaided); check 13 `required_invariants` theo từng hồ sơ (0 fail); archetype fingerprint ≥ 80%; mastery direction vs expected ≥ 80%.
  - `golden/e2e-journey.test.ts` — referential integrity 24 journey; 15 E2E invariant; ranh giới child-projection (FAIL-12) qua `createApi`; cả 15 failure-recovery scenario map vào assertion engine/ledger.
  - `golden-gate.test.ts` — thêm 2 gate: 48/48 hồ sơ plan trong budget; 24 family ↔ journey ↔ twin-profile resolve.
  - **Bug đã sửa khi test:** `buildDailyPlan` trước đây cho phép vượt time budget +3′ (slack cứng trong `fillBudget`) — vi phạm invariant "Daily Plan must never exceed selected time budget". Đã bỏ slack; nếu mọi action đều dài hơn budget thì lấy 1 action ROI cao nhất và cắt còn đúng budget.
  - `golden-data/README.md` — mô tả cả 4 bộ golden + phần nào assert, phần nào hoãn tới calibrate.
  - `@copilot/testing` index giờ export golden loader + pipeline runner để tái dùng.
  - **Cần calibrate (không chặn) — cùng một nguyên nhân gốc "nhạy cảm với 1 quan sát":**
    1. 12/663 cặp (skill × hồ sơ) engine cho mastery ~0 trong khi dataset để ~75 conf thấp — 1 lần sai chưa verify.
    2. Engine surface `concept_gap` (mọi hồ sơ có 3–12 gap, kể cả `standard_progress`) từ 1 quan sát sai; dataset coi đó là `none_or_low_priority`.
    Cả 2 là tinh chỉnh ngưỡng sparse-evidence ở pilot (P-02), **không phải lỗi logic** — lifecycle vẫn đúng (gap luôn `DETECTED`, không auto-confirm), rationale vẫn nêu đúng tên kỹ năng gốc.

| # | Nội dung | Trạng thái |
|---|---|---|
| D-03 | **Ngân hàng câu hỏi authored** (100–200 câu, mỗi skill/problem-type) | ⏳ chưa có — `@copilot/practice` hiện có 7 câu mẫu. Dev Core README §"việc cần làm tiếp" #4 cũng ghi. |
| D-04 | **Item-level curriculum G7 + full prereq DAG lớp 1–9** | ⏳ Dev Core mới có skill-level; prereq graph G7 provisional. |
| D-05 | **8 golden question case** cần domain sâu (factorization, combinatorics HSG…) | Có trong 120 câu nhưng problem_type là free-form slug, engine map best-effort. |

## C1. Màn hình còn thiếu (không chặn — engine + projection đã đủ)

| # | Nội dung | Phase gốc | Ghi chú |
|---|---|---|---|
| S-01 | Scan → AI confirmation flow (P05/P06) | 6 | Cần LLM/OCR provider (P-04). Projection + evidence path đã sẵn; chỉ thiếu adapter + UI. |
| S-02 | Teaching Session live (P09), Teach Me 3' (P08) | 6 | Content generation — authored-first, cần question bank rộng (D-03). |
| S-03 | Mobile app (Expo/RN) parity | 6–7 | Web đã có Parent Home/Progress/Gap. Mobile scaffold sẽ làm ở phase sau, dùng chung `@copilot/projections` + `@copilot/design-tokens`. |
| S-04 | Weekly Report (P14), Notifications (P15) | 9 | |

## C. Golden cases đang `todo` (thiếu dữ liệu D-01)

Xem `packages/testing/src/golden-registry.test.ts`. Các case skip/todo:
- GT-G4-02 (word problems sâu), GT-G4-08 (mixed-level cần Geometry/Logic domain)
- GT-G7-01 (mixed review: %, geometry, combinatorial), GT-G7-06/07 (factorization sâu)

Sẽ bật khi có D-01.
