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

## A. Quyết định cần anh duyệt

| # | Nội dung | Bối cảnh | Đề xuất của em | Trạng thái |
|---|---|---|---|---|
| P-01 | **Chuyên gia Toán review** (a) M7.\* skill IDs `provisional_normalization`, (b) prereq DAG G7 + 9 cross-grade bridges, (c) 5 synthetic above-grade families | Dev Core v1.0 README nói rõ M7 IDs KHÔNG nên freeze trước review. Ảnh hưởng mọi mastery/gap decision cho lớp 7. | Anh chỉ định 1 giáo viên Toán; em xuất DAG + skill list dạng bảng để review | 🔴 quan trọng — chờ anh |
| P-02 | **Coefficients calibration** (R3) | mastery/gap_score/readiness coefficients đang `provisional`, đặt bằng phán đoán | Giữ provisional tới khi có evidence pilot thật; anh/chuyên gia review ngưỡng | ⏳ chờ pilot |
| P-03 | **Auth con: PIN 4 số per-child** | Thiết kế + spec đều dùng PIN; em implement theo hướng này | Xác nhận PIN per-child (không device-based) cho MVP | ⏳ chờ anh |
| P-04 | **LLM/OCR provider mặc định + ngân sách pilot** | Phase 2 để adapter; Phase 9 (scan) cần provider thật | Claude cho LLM; OCR: thử Google Vision / Azure — cần anh chốt ngân sách | ⏳ chờ anh |
| P-05 | **Yêu cầu pháp lý dữ liệu trẻ em VN** (R8) | consent, retention, xoá dữ liệu | Em làm consent-gated + retention config; anh xác nhận có nghĩa vụ pháp lý cụ thể nào | ⏳ chờ anh |

## B. Dữ liệu — CẬP NHẬT 2026-08-31

✅ **D-01 ĐÃ NHẬN** — Math Dev Core v1.0 (52 M4 + 37 M7 skills, curriculum, prereq graphs). Đã ingest, KB có 94 skills. **Lưu ý: M7.\* IDs là `provisional_normalization`** — cần math-educator review trước khi freeze production (đây chính là P-01, giờ quan trọng hơn).
✅ **D-02 ĐÃ NHẬN** — 12 golden student profiles + 120 golden questions + 360 golden error cases + 15 curated scenarios. Đã wire vào test thật.

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
