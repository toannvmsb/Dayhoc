# 11 — Risks & Open Questions

> **⚠ Một phần bị SUPERSEDED bởi Architecture Migration v1.1 (AI-Generation-First — chờ anh duyệt).** Xung đột + luật mới: `docs/implementation/12`–`17`. Doc này sẽ được cập nhật khi migration được APPROVE.

> Bao gồm: top risks, các **inconsistency giữa tài liệu nguồn**, và các **quyết định cần anh duyệt** trước Phase 0.

---

## A. Inconsistency phát hiện giữa tài liệu nguồn

### C1 — Skill ID scheme không thống nhất (impact: cao)
- Grade 4 dùng `M4.*` (vd `M4.ARITH.DISTRIBUTIVE`), Grade 7 dùng `G7.*` (vd `G7.RAT`).
- Tech Spec §4 lại yêu cầu **Skill IDs toàn cục, grade chỉ là mapping**, không partition theo grade.
- **Xung đột:** prefix mã hóa grade (`M4`, `G7`) mâu thuẫn nguyên tắc "ID không theo grade" và gây khó cho cross-grade prerequisite DAG (G4→…→G9).
- **Đề xuất giải quyết:** giữ ID **ổn định & mờ grade** (opaque), tách `grade_context`/`curriculum_origin` thành metadata riêng. Ví dụ scheme: `MATH.<DOMAIN>.<TOPIC>.<n>` + field `grade_context`. Giữ `M4.*`/`G7.*` làm **alias/legacy** trong data để không mất công đã có.
- **Cần duyệt.**

### C2 — Golden test IDs đặt tên khác nhau ở 3 nguồn (impact: trung bình)
- Grade4 md: `G4-01..08`; Grade7 md: `G7-01..10`; Tech Spec §14: `G4-ADV, G4-EXAM, G7-CROSS, G7-15AUG, G7-IDENTITY, CARELESS, PARENT-HYP`.
- **Bản chất:** nội dung phần lớn trùng, chỉ **khác tên**.
- **Đã xử lý:** hợp nhất thành registry `GT-G4-*`/`GT-G7-*` với alias (xem `08_GOLDEN_TEST_PLAN`). Cần anh xác nhận cách đặt tên hợp nhất.

### N1 — Hai loại "mix" dễ nhầm (impact: thấp, chỉ cần rõ ràng)
- **Learning Mix** (school/gap_repair/advanced/thinking) và **Adaptive Practice default mix** (basic 0.45 / variation 0.30 / thinking 0.25) là **hai trục khác nhau**, không mâu thuẫn nhưng dễ lẫn. Đã ghi chú tách bạch ở `07_MATH_ENGINE_PLAN §11`.

### N2 — Taxonomy K/T khác nhãn giữa Grade 4 và Grade 7 (impact: thấp)
- Vd `T1`: Grade4 `recall_execute` vs Grade7 `execute`; `K2`: `textbook_standard` vs `grade7_standard`.
- **Đề xuất:** một taxonomy grade-agnostic ở `/math/shared` + nhãn hiển thị theo grade. Không cần duyệt lớn.

---

## B. Top 10 Risks / Open Questions

| # | Risk / Question | Ảnh hưởng | Giảm thiểu / Cần gì |
|---|---|---|---|
| R1 | **Skill ID scheme** (C1) chưa chốt | Chặn Phase 1, ảnh hưởng toàn bộ data & DAG | Chốt scheme trước Phase 1 — **cần anh duyệt** |
| R2 | **Golden naming** (C2) | Nhầm lẫn khi build test | Xác nhận registry hợp nhất |
| R3 | **Coefficients chưa calibrate** (mastery, gap_score) | Engine có thể over/under-diagnose | Để config + "provisional"; calibrate bằng evidence pilot; cần math educator review |
| R4 | **Item-level SGK → skill mapping chưa đầy đủ** (Math Core §42 note) | Coverage thiếu ở Phase 1 | Bắt đầu với skill-level, bổ sung item dần; ai chốt nguồn item? |
| R5 | **Prerequisite validation bởi giáo viên Toán** chưa có | DAG có thể sai sư phạm | Cần chuyên gia review DAG trước pilot — **ai đảm nhận?** |
| R6 | **OCR/Vision cho vở/bài viết tay tiếng Việt + ký hiệu Toán** | Độ chính xác scan ảnh hưởng evidence | Luôn có confirmation screen; chọn provider mạnh; đo accuracy sớm |
| R7 | **AI generation chất lượng & an toàn** (đề sai/lệch K,T) | Bài tập kém chất lượng | Authored-first, AI sau schema + validate; kiểm định mẫu |
| R8 | **Child data privacy / consent (trẻ vị thành niên)** | Pháp lý & niềm tin | Consent-gated, no public profile, retention/deletion; xác nhận yêu cầu pháp lý VN |
| R9 | **AI cost/latency ở quy mô pilot** | Chi phí vận hành | Track token/cost/latency, cache generation, budget alert |
| R10 | **Scope creep** (LMS/gamification/đa môn) | Trễ MVP | Locked scope; mọi thay đổi lớn qua PROPOSED CHANGE |

Bổ sung open questions:
- **Auth con:** PIN per child hay device-based? (ảnh hưởng UX + bảo mật)
- **Provider LLM/OCR mặc định** và ngân sách pilot?
- **Nơi đặt repo & tên package gốc** (xem quyết định D3).
- **Ngôn ngữ nội dung engine/data:** VI cho content, EN cho code/identifier — xác nhận.

---

## C. Quyết định cần anh duyệt (trước Phase 0)

| ID | Quyết định | Đề xuất của tôi |
|---|---|---|
| **D1** | Skill ID scheme (grade-opaque + metadata) | Áp dụng `MATH.<DOMAIN>.<TOPIC>.<n>` + `grade_context`, giữ `M4/G7` làm alias |
| **D2** | Golden registry hợp nhất `GT-G4-*`/`GT-G7-*` | Áp dụng như `08_GOLDEN_TEST_PLAN` |
| **D3** | **Vị trí project** | Tạo project mới tại `D:\Lap trinh\Claude\Dayhoc\` (nơi có sẵn tài liệu), **không** đụng repo PhongThuy |
| **D4** | Stack: monorepo Next.js + Expo/RN + Postgres + Redis + S3 + Claude LLM | Theo Tech Spec — xác nhận |
| **D5** | Ai review sư phạm DAG/prerequisite trước pilot | Cần anh chỉ định chuyên gia Toán |

> Các quyết định nhỏ (folder chi tiết, tên biến, lib phụ) tôi tự quyết. Chỉ thay đổi lớn ảnh hưởng LOCKED MVP mới cần PROPOSED CHANGE + chờ duyệt.
