# PENDING — cần anh duyệt / bổ sung

> Tổng hợp các điểm vướng, quyết định cần duyệt, và dữ liệu cần bổ sung phát sinh
> trong quá trình em làm autonomous các phase. **Không có mục nào trong đây chặn
> phase kế tiếp** — em đã đi vòng hoặc để lại `todo` có đánh dấu.
>
> Cập nhật lần cuối: 2026-08-31.

---

## A. Quyết định cần anh duyệt

| # | Nội dung | Bối cảnh | Đề xuất của em | Trạng thái |
|---|---|---|---|---|
| P-01 | **Chuyên gia Toán review prerequisite DAG** (D5 cũ) | DAG hiện do em dựng từ Math Core, chưa có sư phạm kiểm | Anh chỉ định 1 giáo viên Toán; em xuất DAG dạng bảng dễ đọc để review | ⏳ chờ anh |
| P-02 | **Coefficients calibration** (R3) | mastery/gap_score/readiness coefficients đang `provisional`, đặt bằng phán đoán | Giữ provisional tới khi có evidence pilot thật; anh/chuyên gia review ngưỡng | ⏳ chờ pilot |
| P-03 | **Auth con: PIN 4 số per-child** | Thiết kế + spec đều dùng PIN; em implement theo hướng này | Xác nhận PIN per-child (không device-based) cho MVP | ⏳ chờ anh |
| P-04 | **LLM/OCR provider mặc định + ngân sách pilot** | Phase 2 để adapter; Phase 9 (scan) cần provider thật | Claude cho LLM; OCR: thử Google Vision / Azure — cần anh chốt ngân sách | ⏳ chờ anh |
| P-05 | **Yêu cầu pháp lý dữ liệu trẻ em VN** (R8) | consent, retention, xoá dữ liệu | Em làm consent-gated + retention config; anh xác nhận có nghĩa vụ pháp lý cụ thể nào | ⏳ chờ anh |

## B. Dữ liệu cần bổ sung (không chặn — engine chạy với slice hiện tại)

| # | Nội dung | Ảnh hưởng | Ghi chú |
|---|---|---|---|
| D-01 | **Curriculum Toán lớp 4 & 7 đầy đủ** (mọi domain, item-level) | Coverage golden test; hiện chỉ có fraction/distributive/ratio slice | Anh sẽ cung cấp sau. Golden case cần domain chưa có → `it.todo` đánh dấu rõ. |
| D-02 | **Golden student profiles thật** (8–12 hồ sơ) | Calibration | Hiện dùng synthetic evidence. |
| D-03 | **Ngân hàng câu hỏi authored** (100–200 câu) | Phase 5 practice dùng authored-first trước khi bật AI-gen | Hiện Phase 5 dùng câu mẫu tối thiểu. |

## C. Golden cases đang `todo` (thiếu dữ liệu D-01)

Xem `packages/testing/src/golden-registry.test.ts`. Các case skip/todo:
- GT-G4-02 (word problems sâu), GT-G4-08 (mixed-level cần Geometry/Logic domain)
- GT-G7-01 (mixed review: %, geometry, combinatorial), GT-G7-06/07 (factorization sâu)

Sẽ bật khi có D-01.
