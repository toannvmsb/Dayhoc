# PENDING — cần anh duyệt / bổ sung

> Tổng hợp các điểm vướng, quyết định cần duyệt, và dữ liệu cần bổ sung phát sinh
> trong quá trình em làm autonomous các phase. **Không có mục nào trong đây chặn
> phase kế tiếp** — em đã đi vòng hoặc để lại `todo` có đánh dấu.
>
> Cập nhật lần cuối: 2026-09-01 (Architecture Migration v1.1 — AI-Generation-First).
>
> **Tình trạng:** Vertical slice P0–P10 xong, **263 test xanh**, web PWA test được trên iPhone.
> **⚠ ĐANG CHỜ ANH DUYỆT ARCHITECTURE MIGRATION** (mục 0 dưới) — chưa implement.

---

## 0. ARCHITECTURE MIGRATION v1.1 — chờ anh APPROVE (2026-09-01)

anh chốt Pricing/AI Cost/Routing **v1.1** (thay v1.0). Core change:
**AI_GENERATION_FIRST** + Curriculum Clock + Learning Context Resolver.

Em đã hoàn thành Phase 1–3 (audit + spec + migration plan), **chưa code feature**:

| Doc | Nội dung |
|---|---|
| `12_ARCHITECTURE_MIGRATION_AUDIT.md` | Bảng OLD ASSUMPTION → NEW RULE cho 10 xung đột; mọi file/module bị ảnh hưởng |
| `13_CURRICULUM_CLOCK_AND_CONTEXT_RESOLVER.md` | Spec `CurriculumClockService` + `LearningContextResolver` |
| `14_AI_EXERCISE_GENERATION_ARCHITECTURE.md` | Spec `ExerciseGenerationSpec` → `ExerciseGenerator` → `GeneratedExerciseValidator` |
| `15_AI_COST_AND_MODEL_ROUTING.md` | v1.1 (thay `PRICING_AND_COST_GUARDRAILS.md`): 3 ngưỡng, 4 state, cost theo operation |
| `16_ARCHITECTURE_MIGRATION_CHANGELOG.md` | Danh sách chính xác doc/package/DB/API/test thay đổi |
| `17_IMPLEMENTATION_MIGRATION_PLAN.md` | Atomic steps (Group A/B/C/D), rollback, acceptance, thứ tự |

**Open questions cần anh quyết** (những cái KHÔNG suy ra được từ tài liệu):

| # | Câu hỏi | Gợi ý |
|---|---|---|
| **O-1** | Lịch năm học nào seed cho pilot (ngày khai giảng + Tết + hè 2026–2027, phân phối chương trình SGK G4/G7)? | Em suy được từ nguồn MOET/SGK công khai; anh xác nhận trường pilot có lịch riêng không. Không chặn. |
| **O-2** | `@copilot/practice` có tách làm 2 (`practice` loop + `exercise-gen`) hay giữ 1 package? | Em đề xuất tách — sạch hơn. |
| **O-3** | Reference/Grounding Library: 22 câu nháp hiện tại đủ làm few-shot, hay anh muốn bổ sung trước khi bật generation? | Đủ để bắt đầu; bổ sung song song. |
| **O-4** | Có bật **Interactive Adaptive Mode** (Next-Best-Question) ngay ở pilot, hay chỉ Worksheet Mode trước? | Em đề xuất Worksheet Mode trước (Group C5), Adaptive sau (C6). |
| **O-5** | Migration làm **cuốn chiếu trong nhánh chính** (feature flags) hay 1 nhánh migration lớn? | Em đề xuất cuốn chiếu + flags (đã thiết kế trong doc 17). |

Còn lại: mọi thứ LOCKED trong prompt v1.1 → em coi là đã quyết, không hỏi lại.

---

## A. Quyết định — ✅ ANH ĐÃ CHỐT 5/5 (2026-08-31)

| # | Quyết định của anh | Em đã làm gì |
|---|---|---|
| P-01 | **Em tự rà skill graph/DAG lớp 7 theo SGK trước → xuất bản đề xuất, anh duyệt.** | ✅ **XONG & ÁP DỤNG (2026-09-01, anh duyệt theo khuyến nghị).** `docs/implementation/M7_SKILL_REVIEW.md`. Đã làm: độ phủ 37/37 bài SGK 1:1 (giữ) · đổi tên `M7.RAT.*` → **`M7.QNUM.*`** toàn repo (data + golden fixture + test + docs) · nạp **11 cạnh prereq giữa chương** vào `prerequisite_graph.yaml` (KB grade-7: 34→47 edge, vẫn acyclic) · hạ cầu `M4.ALG.FIND_X→M7.QNUM.ORDER_TRANSPOSE` 0.6→0.45 · thêm 2 prereq cho `M7.PROOF.ALGEBRA`. **`status: educator_reviewed`, M7.* ID ĐÃ FREEZE** (trọng số importance vẫn provisional theo P-02). 263 test xanh. |
| P-02 | Giữ coefficients provisional tới khi có pilot data. | ✅ Đã đúng (config tách riêng, mọi output có `confidence`). |
| P-03 | **Con login = username + password do bố mẹ tạo (con đổi được). PIN 4 số = shortcut vào bài được giao, KHÔNG phải login.** | ✅ `04_DATABASE_MODEL §1`: `child_credentials` + `child_quick_access` (scope='assigned_work'). Migration `1756684800000`. CLAUDE.md role restrictions cập nhật. |
| P-04 | Chưa chốt LLM/OCR — dùng mock, quay lại sau. **CẬP NHẬT 2026-09-01:** anh cấp Pricing + AI Cost Guardrails v1.0 + AI/OCR Benchmark Kit v1.0. | ✅ **Architecture đã chốt & code:** `@copilot/ai` `pricing.ts` (registry effective-dated) · `routing.ts` (Luna-first matrix) · `margin.ts` (bảng §6 tái lập trong test) · `budget.ts` (target/ceiling + guardrail chống retry-loop) · `usage-event.ts` (telemetry §7). Migration `1756771200000_ai_cost_telemetry` (`ai_pricing_registry`, `ai_usage_events` ⊕, `plan_budget_ledger`) — up/down/up + trigger verified. Benchmark harness `@copilot/testing/src/benchmark/*` + vendor kit. Docs: `PRICING_AND_COST_GUARDRAILS.md` + delta 03/04/06 + CLAUDE.md. **ĐỢT 2 (2026-09-01) anh chốt:** Q1 = **hoãn benchmark, pilot chạy Luna mặc định** → advanced model quyết sau bằng AI COGS thật. Q2 = ca `advanced` chưa có model → **Luna effort cao + cờ review** (`resolveRoute` trả `effectiveTier:'luna'`, `reviewReason`). Q6 = xác nhận FX 26k/USD · retention 30d · target ≥85% Luna · goal→`phat_trien_tu_duy`. Runtime vẫn Mock. |
| P-05 | **17 nguyên tắc Privacy-by-Design → bake vào architecture trước khi build module data trẻ em.** | ✅ `docs/implementation/PRIVACY_ARCHITECTURE.md` + delta vào docs 03/04/05/06. Migration `1756684800000_privacy_foundation`: `consent_records` (⊕ versioned), `ai_provider_registry` (`training_allowed` CHECK false), `data_processing_inventory`, `deletion_jobs`, `rights_requests` (⊕), upload retention 30d. `@copilot/ai` `minimizeForProvider()` + 5 test. Consent UI = deliverable sau. |

## B. Dữ liệu — CẬP NHẬT 2026-08-31

✅ **D-01 ĐÃ NHẬN** — Math Dev Core v1.0 (52 M4 + 37 M7 skills, curriculum, prereq graphs). Đã ingest, KB có 94 skills. **M7.\* IDs đã qua P-01 review (2026-09-01), `status: educator_reviewed`, đã freeze** (`M7.RAT.*`→`M7.QNUM.*`, +11 cạnh DAG).
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
| D-03 | **Ngân hàng câu hỏi authored** (100–200 câu, mỗi skill/problem-type) | 🔄 **Đang làm (anh chốt Q5 = em sinh nháp):** Batch 1 = 22 câu nháp AI (`questions.ai-draft.json`, `origin: ai_generated`, id `.AI.`) phủ 17 skill lõi M4+M7, đủ 6 bậc gợi ý. Kế hoạch + quy trình GV duyệt: `docs/implementation/QUESTION_BANK_PLAN.md`. Còn ~130 câu để đạt "2 câu/skill". |
| D-04 | **Item-level curriculum G7 + full prereq DAG lớp 1–9** | ⏳ Dev Core mới có skill-level; prereq graph G7 provisional. |
| D-05 | **8 golden question case** cần domain sâu (factorization, combinatorics HSG…) | Có trong 120 câu nhưng problem_type là free-form slug, engine map best-effort. |
| D-07 | **30–50 ảnh vở/bài kiểm tra THẬT đã ẩn PII** + ground truth người xác minh. | ⏸ **Hoãn tới sau pilot** (anh chốt Q1, 2026-09-01). Pilot chạy Luna mặc định; kit 40 slot vẫn sẵn ở `packages/testing/benchmark-data/`. Sau pilot: gom ảnh → chạy 4 pipeline → điền `FINAL_ROUTING_DECISION_TEMPLATE.json` + 3 report → anh duyệt. |

## C1. Màn hình còn thiếu (không chặn — engine + projection đã đủ)

| # | Nội dung | Phase gốc | Ghi chú |
|---|---|---|---|
| S-01 | Scan → AI confirmation flow (P05/P06) | 6 | Cần LLM/OCR provider (P-04). Projection + evidence path đã sẵn; chỉ thiếu adapter + UI. |
| S-02 | Teaching Session live (P09), Teach Me 3' (P08) | 6 | Content generation — authored-first, cần question bank rộng (D-03). |
| S-03 | Mobile app (Expo/RN) parity | 6–7 | **Test tạm trên iPhone qua web PWA đã sẵn sàng** (`docs/implementation/DEVICE_TESTING.md`): `npm run dev --workspace @copilot/web` → Safari iPhone mở `http://<IP-máy>:3100` → Add to Home Screen. Đủ 11 màn hình, có manifest + icon + safe-area. App native Expo/RN vẫn là bước sau. |
| S-04 | Weekly Report (P14), Notifications (P15) | 9 | |

## C. Golden cases đang `todo` (thiếu dữ liệu D-01)

Xem `packages/testing/src/golden-registry.test.ts`. Các case skip/todo:
- GT-G4-02 (word problems sâu), GT-G4-08 (mixed-level cần Geometry/Logic domain)
- GT-G7-01 (mixed review: %, geometry, combinatorial), GT-G7-06/07 (factorization sâu)

Sẽ bật khi có D-01.
