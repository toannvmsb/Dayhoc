# P-01 — Rà soát skill graph lớp 7 theo SGK Toán 7 Kết nối tri thức

> **Trạng thái:** bản đề xuất của em (2026-09-01) — **chờ anh duyệt**.
> `M7.*` ID **chưa freeze** cho tới khi anh chốt bảng này.
>
> **Nguồn đối chiếu:** `File du an/Chuong_trinh_SGK_Toan_Lop_7_Ket_noi_tri_thuc.md`
> (10 chương, 37 bài SGK) + SGK Toán 7 KNTT Tập 1 & 2 (`Tai lieu/`).
>
> **Cách anh duyệt:** mở `docs/implementation/M7_SKILL_REVIEW.csv` bằng Google Sheets
> (File → Import), điền cột `anh_duyet` = `OK` hoặc `Sửa`, ghi chú ở cột cuối.
> Hoặc trả lời thẳng theo số mục dưới đây.

---

## 1. Độ phủ skill — ✅ đủ, 1:1

**37/37 bài SGK** đều có đúng 1 skill chuẩn. Không thiếu bài, không thừa skill
chuẩn. 5 skill HSG (origin 8–9) là cố ý (above-grade families).

| Chương | Bài | Skill | | Chương | Bài | Skill |
|---|---|---|---|---|---|---|
| I Số hữu tỉ | 1–4 | `M7.RAT.{SET,OPERATIONS,POWER,ORDER_TRANSPOSE}` | | VI Tỉ lệ | 20–23 | `M7.RATIO.{PROPORTION,EQUAL_CHAIN,DIRECT,INVERSE}` |
| II Số thực | 5–7 | `M7.REAL.{REPEATING_DECIMAL,IRR_SQRT,SET}` | | VII Đa thức | 24–28 | `M7.ALG.{EXPRESSION,POLY_1VAR,POLY_ADD_SUB,POLY_MUL,POLY_DIV}` |
| III Góc·song song | 8–11 | `M7.GEO.{ANGLE_SPECIAL_BISECTOR,PARALLEL_CRITERIA,EUCLID_PARALLEL,THEOREM_PROOF}` | | VIII Xác suất | 29–30 | `M7.PROB.{EVENT,EVENT_PROB}` |
| IV Tam giác bằng nhau | 12–16 | `M7.TRI.{ANGLE_SUM,CONGRUENCE_1,CONGRUENCE_2_3,RIGHT_CONGRUENCE,ISOSCELES_PERP_BISECTOR}` | | IX Quan hệ trong tam giác | 31–35 | `M7.TRI.{ANGLE_OPPOSITE_SIDE,PERP_OBLIQUE,INEQUALITY,CONC_MEDIAN_BISECTOR,CONC_PERP_ALTITUDE}` |
| V Dữ liệu | 17–19 | `M7.DATA.{COLLECT_CLASSIFY,PIE_CHART,LINE_CHART}` | | X Hình khối | 36–37 | `M7.SOLID.{BOX_CUBE,PRISM}` |

5 HSG: `M7.ALG.IDENTITY` · `M7.ALG.FACTOR` · `M7.ALG.SYMMETRIC` · `M7.PROOF.ALGEBRA` · `M7.RATIO.MULTIVAR`.

**→ Cần anh xác nhận:** độ phủ này OK? Có bài SGK nào anh muốn tách nhỏ hơn 1 skill không
(vd Bài 2 "cộng trừ nhân chia số hữu tỉ" có thể tách cộng-trừ / nhân-chia)?

---

## 2. Đặt tên ID — 1 điểm cần anh quyết

**`M7.RAT.*` (số hữu **tỉ**) vs `M7.RATIO.*` (tỉ **lệ**) rất dễ nhầm** — cả khi đọc code
lẫn khi map câu hỏi. Đây là lúc sửa (chưa freeze).

| Phương án | Đổi thành |
|---|---|
| **A (em khuyến nghị)** | `M7.RAT.*` → `M7.QNUM.*` (rational **num**ber). `M7.RATIO.*` giữ nguyên. |
| B | `M7.RATIO.*` → `M7.PROP.*` (proportion). `M7.RAT.*` giữ nguyên. |
| C | Giữ cả hai, chấp nhận rủi ro nhầm. |

Các nit nhỏ hơn (không chặn, em xử luôn nếu anh không phản đối):
- `M7.ALG.EXPRESSION` → `M7.ALG.EXPR` cho đồng bộ độ dài với `POLY_*`.
- `M7.TRI.CONC_*` → giữ `CONC` (concurrency) — đã rõ.

---

## 3. Prerequisite DAG — thiếu 11 cạnh (điểm chính cần anh duyệt)

Dev Core v1.0 chỉ có prereq **trong từng chương**. Thiếu các liên kết **giữa chương**
mà SGK hàm ý rõ. Đề xuất thêm (file `packages/math-data/data/m7-dag-additions.yaml`
đã soạn sẵn, **chưa nạp vào graph** — chờ anh duyệt):

| # | Cạnh đề xuất (from → to) | Lý do (SGK) | importance |
|---|---|---|---|
| 1 | `M7.GEO.EUCLID_PARALLEL` → `M7.GEO.THEOREM_PROOF` | B11 dạy chứng minh dựa trên tính chất song song B10 | 0.7 |
| 2 | `M7.GEO.THEOREM_PROOF` → `M7.TRI.ANGLE_SUM` | B12 chứng minh tổng góc = 180° bằng đường phụ song song | 0.75 |
| 3 | `M7.TRI.ANGLE_SUM` → `M7.TRI.CONGRUENCE_1` | các bài chứng minh bằng nhau dùng tổng góc | 0.6 |
| 4 | `M7.TRI.CONGRUENCE_2_3` → `M7.TRI.ISOSCELES_PERP_BISECTOR` | B16: tính chất tam giác cân + trung trực chứng minh qua c.g.c / g.c.g | 0.8 |
| 5 | `M7.TRI.CONGRUENCE_2_3` → `M7.TRI.ANGLE_OPPOSITE_SIDE` | Chương IX xây trên tam giác bằng nhau (Chương IV) | 0.7 |
| 6 | `M7.TRI.ANGLE_OPPOSITE_SIDE` → `M7.TRI.PERP_OBLIQUE` | B32 nối tiếp B31 | 0.75 |
| 7 | `M7.TRI.PERP_OBLIQUE` → `M7.TRI.INEQUALITY` | B33 dùng quan hệ đường xiên B32 | 0.75 |
| 8 | `M7.TRI.ISOSCELES_PERP_BISECTOR` → `M7.TRI.CONC_MEDIAN_BISECTOR` | B34 đồng quy dùng tính chất trung trực/cân B16 | 0.7 |
| 9 | `M7.TRI.CONC_MEDIAN_BISECTOR` → `M7.TRI.CONC_PERP_ALTITUDE` | B35 nối tiếp B34 | 0.7 |
| 10 | `M7.SOLID.BOX_CUBE` → `M7.SOLID.PRISM` | B37 dựng trên khái niệm thể tích/diện tích xung quanh của B36 | 0.7 |
| 11 | `M7.RAT.POWER` → `M7.REAL.IRR_SQRT` | căn bậc hai số học là phép ngược của lũy thừa 2 | 0.5 |

**Các cạnh trong chương hiện có — em đã kiểm, đúng hết** (20 cạnh: I→I, VI→VI, VII→VII, v.v.
theo đúng thứ tự bài).

**9 cầu nối M4→M7** (file `bridges.yaml`) — em rà lại: **8/9 hợp lý**. 1 điểm nghi vấn:
- `M4.ALG.FIND_X → M7.RAT.ORDER_TRANSPOSE` (imp 0.6): "tìm x" lớp 4 và "quy tắc chuyển vế"
  lớp 7 liên quan nhưng hơi xa. **Đề xuất hạ importance xuống 0.45** hoặc bỏ. Anh quyết.

---

## 4. 5 family HSG — prereq đủ chưa

| Skill HSG | prereq hiện tại | Em đánh giá |
|---|---|---|
| `M7.ALG.IDENTITY` | `M7.ALG.POLY_MUL` | ✅ đủ |
| `M7.ALG.FACTOR` | `M7.ALG.IDENTITY` | ✅ đủ (có thể thêm `M7.ALG.POLY_DIV` — optional) |
| `M7.ALG.SYMMETRIC` | `M7.ALG.IDENTITY` | ✅ đủ |
| `M7.PROOF.ALGEBRA` | `M7.ALG.SYMMETRIC` | ⚠️ nên thêm `M7.REAL.IRR_SQRT` (bất đẳng thức có căn) + `M7.RAT.ORDER_TRANSPOSE` |
| `M7.RATIO.MULTIVAR` | `M7.RATIO.EQUAL_CHAIN` | ✅ đủ |

---

## 5. Tóm tắt việc anh cần quyết

| Mục | Câu hỏi | Mặc định nếu anh không phản hồi |
|---|---|---|
| §1 | Độ phủ 37 skill OK? Tách bài nào nhỏ hơn không? | Giữ 1:1 |
| §2 | `M7.RAT.*` đổi tên? (A / B / C) | **A** — `M7.RAT.*` → `M7.QNUM.*` |
| §3 | Duyệt 11 cạnh DAG thêm? Cạnh nào bỏ? | Nạp cả 11 |
| §3 | `M4.ALG.FIND_X → M7.RAT.ORDER_TRANSPOSE`: hạ 0.45 / bỏ / giữ? | Hạ 0.45 |
| §4 | Thêm 2 prereq cho `M7.PROOF.ALGEBRA`? | Thêm |

Sau khi anh chốt: em nạp thay đổi vào `skill_graph.yaml` + `bridges.yaml` +
`build-kb.mjs`, đổi `status: provisional_normalization` → `status: educator_reviewed`,
cập nhật test, và **freeze `M7.*` ID**.
