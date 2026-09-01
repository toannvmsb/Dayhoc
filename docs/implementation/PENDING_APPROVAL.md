# PENDING — cần anh duyệt / bổ sung

> Tổng hợp các điểm vướng, quyết định cần duyệt, và dữ liệu cần bổ sung phát sinh
> trong quá trình em làm autonomous các phase. **Không có mục nào trong đây chặn
> phase kế tiếp** — em đã đi vòng hoặc để lại `todo` có đánh dấu.
>
> Cập nhật lần cuối: 2026-09-01 (Architecture Migration v1.1 — AI-Generation-First).
>
> **Tình trạng:** Vertical slice P0–P10 xong, web PWA test được trên iPhone.
> Migration v1.1: **A ✅ · B1+B2+B3 ✅ · pace ✅ · C1+C2+C3 ✅ · C3.1 ✅ · C4 ✅ · C4.1 ✅ · C4.2 ✅ · C5 (SHADOW MODE) ✅ · C5.1 (benchmark hardening) ✅ (460 test / 5 skip, KHÔNG chạy live AI, LIVE mode CHƯA bật)**.
> **⚠ ĐANG CHỜ ANH DUYỆT C5.1 + cấp key + cho phép chạy benchmark Luna, trước khi flip sang LIVE.

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

**Open questions — ✅ ANH ĐÃ CHỐT 5/5 (2026-09-01):**

| # | Quyết định |
|---|---|
| **O-1** | Em seed lịch năm học từ nguồn MOET/SGK công khai (2026–2027: khai giảng, Tết, hè, phân phối chương trình G4/G7). Anh xác nhận trường pilot có lịch riêng sau — không chặn. |
| **O-2** | **Tách** `@copilot/practice` → `@copilot/practice` (loop/hint/submission) + `@copilot/exercise-gen`. |
| **O-3** | 22 câu nháp đủ làm few-shot grounding để bắt đầu; bổ sung song song. |
| **O-4** | **Worksheet Mode trước** (Group C5), Interactive Adaptive Mode sau (C6). |
| **O-5** | **Cuốn chiếu trong `main` + feature flags** (không nhánh migration lớn). |

→ **`17_IMPLEMENTATION_MIGRATION_PLAN.md` được duyệt.** Em bắt đầu Group A (cost/routing v1.1 — an toàn nhất, additive), rồi Group B/C/D theo thứ tự.
Mọi thứ LOCKED trong prompt v1.1 = đã quyết, không hỏi lại.

**Tiến độ (2026-09-01):**
- **Group A ✅** — `packages/ai` (margin/budget/routing/usage-event) v1.1, migration `1756857600000_ai_cost_v1_1.js`, benchmark harness. APPROVED.
- **Group B1+B2 ✅** — `@copilot/curriculum-clock`, `resolveLearningContext`, calendars G4/G7. APPROVED.
- **Group B3 ✅ — CHỜ ANH DUYỆT.** Clock + resolver wired vào runtime + API (`GET /children/:id/learning-context`, `POST .../confirm-lesson`) + web card. `expectedWindow` (range, không phải 1 bài), guardrail A–F, calendar provenance metadata, confirm-lesson append-only. 305 test. Demo 3 trẻ: [`B3_DEMO_OUTPUT.md`](B3_DEMO_OUTPUT.md). Chi tiết trong [17 §B3](17_IMPLEMENTATION_MIGRATION_PLAN.md).
- **Pace policy ✅ commit `6c2b3dc`** — `packages/learning-context/src/pace.ts` `evaluatePace` (doc 13 §4 LOCKED): ≥3 obs → hypothesis; ≥5 obs / ≥2 school weeks → auto-apply LOW; confirmation ≥2 lessons off → floor drops to 3; bounded (hyp ±0.35, auto ±0.25); decays on stale/conflicting evidence; applied pace only shifts FUTURE estimate, never `resolved` confidence.
- **Group C1 ✅ commit `1d4caae`** — `ExerciseGenerationSpec` (domain) + schema + `buildExerciseGenerationSpec` (deterministic, `@copilot/planning`). CASE A–D tests + 48-profile golden.
- **Group C2 ✅ commit `5065452`** — `@copilot/reference-library` (repurposed question bank: grounding/calibration/evaluation only, NOT delivery). `@copilot/practice` no longer exports `loadQuestionBank`; `buildAssignment` = LEGACY shim until C5.
- **Group C3 ✅ commit `32ca44d`** — `@copilot/exercise-gen` `validateGeneratedBatch` — deterministic gate.
- **Group C3.1 ✅ commit `3d3c757`** — Thinking-Level policy (T từ demonstrated evidence + goal + readiness; HSG+ready+strong→T4/T5; HSG+weak→không tự nâng T5). `GeneratedExercise.requiredSkillIds` + prereq safety theo required-closure. `ItemValidationOutcome` vs `BatchDisposition` (DELIVER/REPAIR/REGENERATE_SLOTS/QUARANTINE), `deliverable` chỉ khi đủ câu — KHÔNG giao worksheet thiếu âm thầm. Bỏ hard-code version → `KnowledgeBase.provenance` (datasetRevision + contentHash).
- **Group C4 ✅ commit `83a8cbc`/`42d30a4`** — `ExerciseGenerator` interface (education-dumb, no PII/twin), `buildGenerationGrounding`, `MockExerciseGenerator`, `orchestrateGeneration` (bounded 2×2), repair policy, telemetry, persistence (migration `1757030400000`).
- **Group C4.1 ✅ commit `c302e37`/`27473bd`** — target selection + pipeline hardening. `spec.targets.skills: TargetSkill[]` với `role` CURRENT/PREREQUISITE_REPAIR/FRONTIER/THINKING + `buckets[]` + `knowledgeCeiling`. `selectLearningTargets()` (`@copilot/planning`, deterministic) — AI KHÔNG chọn frontier skill. `DomainFrontierView` structured (bỏ magic string). ADVANCED KNOWLEDGE (bucket `advanced` ⟺ FRONTIER target, K4/K5) ≠ ADVANCED THINKING (bucket `thinkingChallenge` ⟺ THINKING target, T4/T5, K lớp). `grounding.bucketBindings`. Validator: `TARGET_ROLE_MISMATCH`/`FRONTIER_SKILL_NOT_SELECTED`/`REQUIRED_SKILL_OUT_OF_BOUNDS`. Cost telemetry `estimatedCost*` (forecast) vs `actualCost*` (ledger). Migration `1757116800000` (`ai_usage_events.actual_cost_*` + `generation_specs.target_selector_version`). Mock E2E numeric/fraction/reasoning. **KHÔNG có live provider.**
- **Group C4.2 ✅ commit (this)** — Learning Context / Frontier separation + Next Safe Frontier. `curriculum.nodeType` (CORE_CURRICULUM/ENRICHMENT/ADVANCED/HSG/DIAGNOSTIC/REFERENCE) + `isEligibleForCurrentLearningContext()` — node synthetic `C.G7.EXT.0` KHÔNG BAO GIỜ thành `resolved.lessonId` nữa (kể cả khi có confirmation), dù evidence Grade-9 vẫn cập nhật Twin/Frontier bình thường. `selectLearningTargets()` v2: FRONTIER candidate tách `NEXT_SAFE_FRONTIER` (readyNext, ưu tiên origin gần nhất) vs `MASTERED_FRONTIER_STRETCH` (đã mastered, above-grade) — trẻ lớp 7 có bằng chứng Đại số lớp 9 nhưng cầu nối lớp 8 còn yếu sẽ được chọn skill lớp 8 trước, có `selectionReason`/`selectedCurriculumOrigin`/`frontierEvidenceOrigin`/`selectionConfidence` truy vết đầy đủ. KHÔNG có "mở khoá toàn bộ lớp 9" — chỉ những skill đồ thị tiên quyết thực sự hỗ trợ mới được xét. Thinking fallback: hết T4/T5 trên skill hiện tại → thử skill liền kề cùng-domain/cùng-lớp có tiên quyết đủ (`THINKING_ADJACENT_FALLBACK`); không có thì KHÔNG bịa target. `selectLearningTargets` trả về `trace` (candidates/rejected/selected) để debug, không lưu vào spec. Không có migration mới (mọi thay đổi nằm trong JSONB `spec` sẵn có + file KB). **415 test xanh / 2 skip. KHÔNG có live provider.**
- **Group C5 ✅ commit (this)** — LIVE AI GENERATION IN SHADOW MODE. KHÔNG thay legacy practice; mục đích = ĐO xem model live có đáp ứng hợp đồng giáo dục deterministic ở mức QUALITY/RELIABILITY/LATENCY/COST chấp nhận được không. Production vẫn `Legacy Practice → Child`; shadow path chạy song song, KHÔNG BAO GIỜ tới trẻ. `AIProviderAdapter` (`@copilot/ai/provider.ts`) là port cô lập; `createOpenAiProviderAdapter` (`providers/openai-adapter.ts`) là file DUY NHẤT biết OpenAI; `LunaExerciseGenerator` (`@copilot/exercise-gen/luna-generator.ts`) implement interface `ExerciseGenerator` C4 không đổi. Config `loadAiGenerationConfig()` (`AI_GENERATION_DEFAULT_PROVIDER/_MODEL/AI_PRICING_CONFIG_VERSION/AI_GENERATION_MODE`), KHÔNG hard-code tên model ngoài adapter; key `OPENAI_API_KEY` đọc runtime, KHÔNG lưu đâu. **2 cổng vẫn còn**: provider JSON-mode → Zod parse → `GeneratedExerciseValidator` đầy đủ. System prompt `exercise-generator-prompt.v1` (education-dumb; SPEC/REFERENCE là DATA không phải lệnh; `promptVersion` lưu vào op + trace). Payload gửi provider = CHỈ `GenerationGrounding` (không childId/tên/Twin/evidence/history — có test khẳng định). Reason code mới `REFERENCE_EXAMPLE_COPY` (validator nhận `grounding.referenceExamples`, chặn copy nguyên văn → REGEN). `AnswerVerificationLevel` (DETERMINISTIC_VERIFIED/AI_CROSSCHECK_REQUIRED/HUMAN_GOLDEN_VERIFIED/UNVERIFIED) — check well-formed cho numeric/fraction/choice/exact; reasoning → AI_CROSSCHECK_REQUIRED. `SecondPassVerifier` port + `wouldRequireVerification` trigger + stub — KHÔNG nối second call live. Actual cost: `computeActualCost(usage, model, at, PricingRegistry)` effective-dated; `estimatedCostUsd` vẫn forecast; không có giá → `null` (không giả actual). `GenerationOperation` +`promptVersion`/`inputTokens`/`cachedInputTokens`/`outputTokens`/`actualCostVnd`/`priceConfigVersion`/`escalatedFrom`. `AiGenerationMode` OFF/SHADOW/LIVE (default OFF); `ShadowGenerationQueue` port + `InMemoryShadowGenerationQueue` (`setImmediate`, error-isolated); `services/api` `childToday` enqueue shadow run SAU khi trả legacy view — child view byte-identical với legacy, shadow fail không tới trẻ. **LIVE CHƯA bật.** `PgGenerationStore` (`@copilot/exercise-gen/pg`) — KHÔNG có migration mới (reuse `generation_specs`/`generated_exercise_sets`); integration test xanh trên PG portable. `aggregateShadowMetrics` + benchmark harness (`@copilot/testing` `benchmark/luna-generation-benchmark.ts`, `buildBenchmarkSpecs` từ 48 hồ sơ golden tổng hợp) + `C5_SHADOW_GATES` (review, KHÔNG auto-flip). Advanced provider vẫn OPEN_PENDING_BENCHMARK. **446 test / 5 skip. KHÔNG chạy live provider (không có key trong env build).** Chi tiết: [18_LIVE_AI_GENERATION_SHADOW_MODE.md](18_LIVE_AI_GENERATION_SHADOW_MODE.md).
- **Group C5.1 ✅ commit (this)** — BENCHMARK READINESS HARDENING (doc `18` §14–§20). (1) **Answer verification FORMAT ≠ CORRECTNESS**: `AnswerVerificationLevel` = `FORMAT_VERIFIED | DETERMINISTIC_CORRECTNESS_VERIFIED | AI_CROSSCHECK_REQUIRED | HUMAN_GOLDEN_VERIFIED | UNVERIFIED`. Answer key well-formed ⇒ chỉ `FORMAT_VERIFIED`; muốn `DETERMINISTIC_CORRECTNESS_VERIFIED` phải có checker độc lập tính lại; sai chứng minh được ⇒ `UNVERIFIED` + validator raise `ANSWER_INCONSISTENT` (không giao). (2) **Math verifier hẹp** `math-verifier.ts` `verifyMathAnswer` → CORRECT/INCORRECT/UNSUPPORTED — số nguyên/thập phân/phân số, `+ - × · * / :` + ngoặc, bigint-rational chính xác. Chỉ trích biểu thức khi đề gần như CHỈ là biểu thức; có "ước lượng/làm tròn/gần/…" hoặc chỗ trống (`?`, `_`, `x`, `điền`) hoặc còn văn xuôi ⇒ `UNSUPPORTED` (KHÔNG đoán). `choice` sai ⇒ `UNSUPPORTED` (không phải INCORRECT — rủi ro "gần nhất"). Đã sửa 3 false positive trong reference-library. KHÔNG phải CAS. (3) **Strict structured output** config `AI_GENERATION_STRUCTURED_OUTPUT_MODE` = `STRICT_JSON_SCHEMA | JSON_OBJECT_FALLBACK` (default FALLBACK); `openai-adapter` gửi `response_format:{type:'json_schema',strict:true}` chỉ khi có schema, else HẠ CẤP trung thực + báo mode thật. Schema tay `@copilot/schemas` `GENERATED_BATCH_JSON_SCHEMA` (`generatedExerciseBatch.jsonschema.v1`). Zod + validator vẫn là hợp đồng thật. (4) **Versioning** `GenerationOperation` +`structuredOutputMode`/`outputSchemaName`/`outputSchemaVersion` (kèm `promptVersion`); benchmark report ghi đủ. (5) **Manifest đóng băng** `luna-benchmark-manifest.ts` `BENCHMARK_MANIFEST_VERSION` + 16 hồ sơ golden (8 G4 + 8 G7), `manifestCoverage` BÁO CẢ GAP (golden dataset không có hồ sơ FRONTIER mạnh / T4-T5). (6) **Spend guardrail** `LIVE_BENCHMARK_MAX_BATCHES` (20) / `LIVE_BENCHMARK_MAX_COST_USD` (5); `runLunaBenchmark` dừng TRƯỚC khi vượt. (7) **`BenchmarkReport`** machine-readable đầy đủ (quality/answers{formatValid/deterministicCorrectness/crosscheckRequired/unverified}/performance/usage/cost{USD,VND,/batch,/q}/failures/perCase/coverage/gates) + `formatBenchmarkReport`. Live test `describe.skipIf(!RUN_LIVE_AI_BENCHMARK)` + check key + cap 600s. **460 test / 5 skip. KHÔNG chạy live provider.**
- **C5b+ ⏸ — CHƯA BẮT ĐẦU** (đợi anh cấp key → CHO PHÉP TƯỜNG MINH chạy benchmark Luna → anh review kết quả → duyệt): flip `AI_GENERATION_MODE=LIVE`, `buildDailyPlan` emit spec, thay `buildAssignmentsForPlan`, xoá bank path cũ, Interactive Adaptive Mode (C6), Next Best Question production, benchmark Terra vs Sonnet từ hard-case của Luna.

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
