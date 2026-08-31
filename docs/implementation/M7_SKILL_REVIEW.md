# P-01 — Rà soát skill graph lớp 7 theo SGK Toán 7 Kết nối tri thức

> **Trạng thái: ✅ ĐÃ DUYỆT & ÁP DỤNG** — anh duyệt theo khuyến nghị 2026-09-01.
> `M7.*` ID **đã freeze** (`status: educator_reviewed`).
>
> **Nguồn đối chiếu:** `File du an/Chuong_trinh_SGK_Toan_Lop_7_Ket_noi_tri_thuc.md`
> (10 chương, 37 bài SGK) + SGK Toán 7 KNTT Tập 1 & 2 (`Tai lieu/`).

---

## 1. Độ phủ skill — ✅ đủ, 1:1 (giữ nguyên)

**37/37 bài SGK** đều có đúng 1 skill chuẩn. 5 skill HSG (origin 8–9) là cố ý.

| Chương | Bài | Skill | | Chương | Bài | Skill |
|---|---|---|---|---|---|---|
| I Số hữu tỉ | 1–4 | `M7.QNUM.{SET,OPERATIONS,POWER,ORDER_TRANSPOSE}` | | VI Tỉ lệ | 20–23 | `M7.RATIO.{PROPORTION,EQUAL_CHAIN,DIRECT,INVERSE}` |
| II Số thực | 5–7 | `M7.REAL.{REPEATING_DECIMAL,IRR_SQRT,SET}` | | VII Đa thức | 24–28 | `M7.ALG.{EXPRESSION,POLY_1VAR,POLY_ADD_SUB,POLY_MUL,POLY_DIV}` |
| III Góc·song song | 8–11 | `M7.GEO.{ANGLE_SPECIAL_BISECTOR,PARALLEL_CRITERIA,EUCLID_PARALLEL,THEOREM_PROOF}` | | VIII Xác suất | 29–30 | `M7.PROB.{EVENT,EVENT_PROB}` |
| IV Tam giác bằng nhau | 12–16 | `M7.TRI.{ANGLE_SUM,CONGRUENCE_1,CONGRUENCE_2_3,RIGHT_CONGRUENCE,ISOSCELES_PERP_BISECTOR}` | | IX Quan hệ trong tam giác | 31–35 | `M7.TRI.{ANGLE_OPPOSITE_SIDE,PERP_OBLIQUE,INEQUALITY,CONC_MEDIAN_BISECTOR,CONC_PERP_ALTITUDE}` |
| V Dữ liệu | 17–19 | `M7.DATA.{COLLECT_CLASSIFY,PIE_CHART,LINE_CHART}` | | X Hình khối | 36–37 | `M7.SOLID.{BOX_CUBE,PRISM}` |

5 HSG: `M7.ALG.IDENTITY` · `M7.ALG.FACTOR` · `M7.ALG.SYMMETRIC` · `M7.PROOF.ALGEBRA` · `M7.RATIO.MULTIVAR`.

---

## 2. Đặt tên ID — ✅ đã đổi (phương án A)

`M7.RAT.*` (số hữu **tỉ**) → **`M7.QNUM.*`** (rational **num**ber), để hết nhầm với
`M7.RATIO.*` (tỉ **lệ**). Đổi trên toàn repo (data + fixture golden + test + docs):

| Cũ | Mới |
|---|---|
| `M7.RAT.SET` | `M7.QNUM.SET` |
| `M7.RAT.OPERATIONS` | `M7.QNUM.OPERATIONS` |
| `M7.RAT.POWER` | `M7.QNUM.POWER` |
| `M7.RAT.ORDER_TRANSPOSE` | `M7.QNUM.ORDER_TRANSPOSE` |

---

## 3. Prerequisite DAG — ✅ đã nạp 11 cạnh giữa chương

Vào `packages/math-data/data/dev-core/grade7/prerequisite_graph.yaml` +
`skill_graph.yaml`. Graph vẫn acyclic. KB grade-7 giờ có **47 prereq edge** (trước 34).

| # | from → to | importance |
|---|---|---|
| 1 | `M7.GEO.EUCLID_PARALLEL` → `M7.GEO.THEOREM_PROOF` | 0.7 |
| 2 | `M7.GEO.THEOREM_PROOF` → `M7.TRI.ANGLE_SUM` | 0.75 |
| 3 | `M7.TRI.ANGLE_SUM` → `M7.TRI.CONGRUENCE_1` | 0.6 |
| 4 | `M7.TRI.CONGRUENCE_2_3` → `M7.TRI.ISOSCELES_PERP_BISECTOR` | 0.8 |
| 5 | `M7.TRI.CONGRUENCE_2_3` → `M7.TRI.ANGLE_OPPOSITE_SIDE` | 0.7 |
| 6 | `M7.TRI.ANGLE_OPPOSITE_SIDE` → `M7.TRI.PERP_OBLIQUE` | 0.75 |
| 7 | `M7.TRI.PERP_OBLIQUE` → `M7.TRI.INEQUALITY` | 0.75 |
| 8 | `M7.TRI.ISOSCELES_PERP_BISECTOR` → `M7.TRI.CONC_MEDIAN_BISECTOR` | 0.7 |
| 9 | `M7.TRI.CONC_MEDIAN_BISECTOR` → `M7.TRI.CONC_PERP_ALTITUDE` | 0.7 |
| 10 | `M7.SOLID.BOX_CUBE` → `M7.SOLID.PRISM` | 0.7 |
| 11 | `M7.QNUM.POWER` → `M7.REAL.IRR_SQRT` | 0.5 |

**§3b — ✅ đã hạ:** cầu `M4.ALG.FIND_X → M7.QNUM.ORDER_TRANSPOSE` importance
`0.6 → 0.45` (`bridges.yaml`).

---

## 4. 5 family HSG — ✅ đã thêm prereq cho `M7.PROOF.ALGEBRA`

`M7.PROOF.ALGEBRA` giờ có 3 prereq: `M7.ALG.SYMMETRIC` (cũ) + `M7.REAL.IRR_SQRT` +
`M7.QNUM.ORDER_TRANSPOSE` (mới). 4 family HSG còn lại giữ nguyên (đã đủ).

---

## Ghi chú

- **Hệ số importance vẫn provisional** — hiệu chỉnh ở pilot (P-02). Cái được freeze
  là **ID + độ phủ + cấu trúc DAG (có/không cạnh)**, không phải trọng số.
- File đề xuất gốc: `packages/math-data/data/m7-dag-additions.yaml` (giữ lại làm bản ghi).
- `M7_SKILL_REVIEW.csv`: bảng skill-by-skill (đã cập nhật ID mới).
