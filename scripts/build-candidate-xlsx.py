#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Biến file JSON do scripts/generate-candidate-questions.mjs sinh ra thành Excel đúng mẫu nhập
(sheet "Câu hỏi" + "Semantic Audit"), kèm cột để người duyệt điền.

  python scripts/build-candidate-xlsx.py [in.json] [out.xlsx]

Sau khi duyệt:  python scripts/questions-xlsx-to-json.py out.xlsx   (chỉ nhập dòng có cột Duyệt = Y)
                node scripts/import-questions.mjs out.raw.json
"""
import json
import sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter

src = sys.argv[1] if len(sys.argv) > 1 else "docs/implementation/data/B1-02_03_candidates.json"
dst = sys.argv[2] if len(sys.argv) > 2 else "docs/implementation/data/B1-02_03_candidate_questions.xlsx"
items = json.load(open(src, encoding="utf-8"))

HEAD = [
    "Mã kỹ năng (skillId)*", "Mức kiến thức (K0-K5)*", "Mức tư duy (T1-T5)*", "Đề bài (prompt)*",
    "Dạng đáp án (answerKind)*", "Đáp án đúng (answerValue)*", "Dung sai (tolerance)",
    "Các lựa chọn (options, cách nhau bằng ;)", "Mã dạng bài (problemTypeId)",
    "Gợi ý 1 — Định hướng*", "Gợi ý 2 — Thu hẹp*", "Gợi ý 3 — Nêu phương pháp*",
    "Gợi ý 4 — Ví dụ dễ hơn*", "Gợi ý 5 — Gần xong*", "Gợi ý 6 — Lời giải đầy đủ*",
    "Lời giải đầy đủ (workedSolution)*",
    # --- cột dành cho người duyệt (importer chỉ đọc cột Duyệt) ---
    "Duyệt (Y/N)", "Ghi chú của người duyệt", "Đợt", "Nhóm dạng bài",
]
wb = Workbook()
ws = wb.active
ws.title = "Câu hỏi"
ws.append(HEAD)

def answer_cells(spec):
    k = spec["kind"]
    if k == "numeric":
        return "numeric", str(spec["value"]), str(spec.get("tolerance", 0)), ""
    if k == "fraction":
        return "fraction", f'{spec["numerator"]}/{spec["denominator"]}', "", ""
    if k == "choice":
        return "choice", spec["correct"], "", ";".join(spec["options"])
    if k == "exact":
        return "exact", spec["value"], "", ""
    raise ValueError(k)

for it in items:
    kind, val, tol, opts = answer_cells(it["answerSpec"])
    ws.append([
        it["skillId"], it["knowledgeLevel"], it["thinkingLevel"], it["prompt"], kind, val, tol, opts, "",
        *it["hints"], it["workedSolution"],
        "", "", it["batch"], it["family"],
    ])

thin = Side(style="thin", color="DDDDDD")
widths = {1: 24, 2: 9, 3: 9, 4: 62, 5: 11, 6: 16, 7: 9, 8: 22, 9: 12, 10: 40, 11: 40, 12: 40, 13: 40, 14: 40, 15: 46, 16: 60, 17: 11, 18: 30, 19: 9, 20: 22}
for c, w in widths.items():
    ws.column_dimensions[get_column_letter(c)].width = w
head_fill = PatternFill("solid", fgColor="0E9384")
review_fill = PatternFill("solid", fgColor="F59E0B")
for c in range(1, len(HEAD) + 1):
    cell = ws.cell(row=1, column=c)
    cell.font = Font(bold=True, color="FFFFFF", name="Arial", size=10)
    cell.fill = review_fill if c >= 17 else head_fill
    cell.alignment = Alignment(wrap_text=True, vertical="center")
ws.row_dimensions[1].height = 42
for row in ws.iter_rows(min_row=2):
    for cell in row:
        cell.alignment = Alignment(wrap_text=True, vertical="top")
        cell.font = Font(name="Arial", size=10)
        cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)
ws.freeze_panes = "E2"
ws.auto_filter.ref = f"A1:{get_column_letter(len(HEAD))}{ws.max_row}"
dv = DataValidation(type="list", formula1='"Y,N"', allow_blank=True)
ws.add_data_validation(dv)
dv.add(f"Q2:Q{ws.max_row}")

# ---- Semantic Audit (importer: cột "Row Câu hỏi" = số dòng trong sheet Câu hỏi) ----
sa = wb.create_sheet("Semantic Audit")
sa.append(["Row Câu hỏi", "problemTypeId", "templateSignature", "similarityRisk", "recommendedCooldownDays", "selectionKey"])
for i, it in enumerate(items, start=2):
    m = it["semantic"]
    sa.append([i, m["archetype"], m["templateSignature"], m["similarityRisk"], m["cooldownDays"], m["selectionKey"]])
for c in range(1, 7):
    sa.cell(row=1, column=c).font = Font(bold=True, name="Arial", size=10)
for c, w in {1: 14, 2: 42, 3: 20, 4: 14, 5: 24, 6: 70}.items():
    sa.column_dimensions[get_column_letter(c)].width = w

# ---- Tổng hợp ----
sm = wb.create_sheet("Tổng hợp")
sm.append(["Đợt", "Mức K/T", "Nhóm dạng bài", "Kỹ năng", "Số câu"])
agg = {}
for it in items:
    key = (it["batch"], f'{it["knowledgeLevel"]}/{it["thinkingLevel"]}', it["family"], it["skillId"])
    agg[key] = agg.get(key, 0) + 1
for key in sorted(agg):
    sm.append([*key, agg[key]])
sm.append([])
sm.append(["Tổng", "", "", "", len(items)])
for c in range(1, 6):
    sm.cell(row=1, column=c).font = Font(bold=True, name="Arial", size=10)
for c, w in {1: 9, 2: 10, 3: 26, 4: 30, 5: 9}.items():
    sm.column_dimensions[get_column_letter(c)].width = w

# ---- Hướng dẫn ----
g = wb.create_sheet("Hướng dẫn duyệt", 0)
guide = [
    "HƯỚNG DẪN DUYỆT — lô câu hỏi ứng viên B1-02 / B1-03",
    "",
    "Đây là câu hỏi do máy sinh theo khuôn mẫu, CHƯA nằm trong hệ thống. Chỉ những dòng anh đánh Y mới được nhập.",
    "",
    "1. Mở sheet “Câu hỏi”. Đọc đề, đáp án, 6 gợi ý và lời giải. Đáp án đã được máy tính lại bằng số học chính xác và đối chiếu với công thức trong lời giải.",
    "2. Cột Q “Duyệt (Y/N)”: điền Y nếu đồng ý đưa vào hệ thống; N hoặc để trống nếu không. Cột R để ghi lý do/sửa đổi.",
    "3. Có thể sửa trực tiếp đề, gợi ý, lời giải trong Excel — hệ thống sẽ nhập đúng nội dung trong file này. Nếu sửa đáp án, nhớ sửa cả cột “Đáp án đúng”.",
    "4. Đừng đổi tiêu đề cột và đừng xoá cột. Đừng sắp xếp lại (Sort) — hãy dùng bộ lọc (Filter) để xem theo nhóm, vì sheet “Semantic Audit” liên kết theo số dòng.",
    "5. Lưu file rồi báo em; em chạy: questions-xlsx-to-json.py → import-questions.mjs (kiểm tra mã kỹ năng, schema, rồi mới ghép vào thư viện).",
    "",
    "Gợi ý các điểm cần để ý khi duyệt:",
    "  • Đề có rõ nghĩa, đúng ngôn ngữ SGK, đúng lớp (M4 = lớp 4, M7 = lớp 7)?",
    "  • Mức độ T4/T5 có thật sự đòi hỏi suy luận (không chỉ là tính dài)?",
    "  • Gợi ý 1→6 tăng dần mức giúp đỡ, gợi ý 6 là lời giải đầy đủ?",
    "  • Với câu K1 (nhận biết) của các kỹ năng HSG/chứng minh: có phù hợp mức nhận biết không?",
    "  • Các câu này do máy sinh; khi anh duyệt (Y) chúng vào thư viện như câu đã được người rà (origin = authored), theo quy ước hiện có cho câu đã qua duyệt.",
]
for line in guide:
    g.append([line])
g.column_dimensions["A"].width = 150
g["A1"].font = Font(bold=True, size=13, name="Arial")
for r in range(2, len(guide) + 1):
    g.cell(row=r, column=1).alignment = Alignment(wrap_text=True, vertical="top")
    g.cell(row=r, column=1).font = Font(name="Arial", size=10)

wb.save(dst)
sys.stdout.reconfigure(encoding="utf-8")
print(f"{len(items)} câu -> {dst}")
