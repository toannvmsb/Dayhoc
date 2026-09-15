#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DẠYZI — bước 1/2 của quy trình nhập câu hỏi vào ngân hàng câu hỏi.

Đọc file Excel anh điền (sheet "Câu hỏi", theo mẫu DayZi_Mau_Nhap_Cau_Hoi.xlsx)
và xuất ra 1 file JSON thô (chưa gán id, chưa kiểm tra mã kỹ năng có thật hay
không — bước đó do scripts/import-questions.mjs làm, vì nó cần đọc knowledge
base thật của app). Script này chỉ đọc đúng cột, bỏ dòng trống, và báo lỗi rõ
ràng ở những dòng thiếu dữ liệu bắt buộc — để anh có thể fix ngay trong Excel
trước khi chạy tiếp bước 2.

  python scripts/questions-xlsx-to-json.py <file.xlsx> [--out out.json]

Không cần cài gì thêm nếu máy đã có Python + openpyxl
(pip install openpyxl nếu báo thiếu).
"""
import sys
import json
import argparse
from openpyxl import load_workbook

REQUIRED_COLS = {
    "skillId": "Mã kỹ năng (skillId)*",
    "knowledgeLevel": "Mức kiến thức (K0-K5)*",
    "thinkingLevel": "Mức tư duy (T1-T5)*",
    "prompt": "Đề bài (prompt)*",
    "answerKind": "Dạng đáp án (answerKind)*",
    "workedSolution": "Lời giải đầy đủ (workedSolution)*",
}
HINT_COLS = [
    "Gợi ý 1 — Định hướng*", "Gợi ý 2 — Thu hẹp*", "Gợi ý 3 — Nêu phương pháp*",
    "Gợi ý 4 — Ví dụ dễ hơn*", "Gợi ý 5 — Gần xong*", "Gợi ý 6 — Lời giải đầy đủ*",
]
VALID_K = {"K0", "K1", "K2", "K3", "K4", "K5"}
VALID_T = {"T1", "T2", "T3", "T4", "T5"}
VALID_KIND = {"exact", "numeric", "fraction", "choice", "reasoning"}


def norm(v):
    if v is None:
        return ""
    return str(v).strip()


def build_answer_spec(kind, value, tolerance, options, row_no, errors):
    if kind == "reasoning":
        return {"kind": "reasoning"}
    if kind == "exact":
        if not value:
            errors.append(f"Dòng {row_no}: answerKind=exact cần Đáp án đúng.")
            return None
        return {"kind": "exact", "value": value}
    if kind == "numeric":
        if not value:
            errors.append(f"Dòng {row_no}: answerKind=numeric cần Đáp án đúng là 1 số.")
            return None
        try:
            num = float(value)
            if num.is_integer():
                num = int(num)
        except ValueError:
            errors.append(f"Dòng {row_no}: Đáp án đúng \"{value}\" không phải là số hợp lệ cho numeric.")
            return None
        tol = 0
        if tolerance:
            try:
                tol = float(tolerance)
            except ValueError:
                errors.append(f"Dòng {row_no}: Dung sai \"{tolerance}\" không phải là số.")
                return None
        return {"kind": "numeric", "value": num, "tolerance": tol}
    if kind == "fraction":
        if not value or "/" not in value:
            errors.append(f"Dòng {row_no}: answerKind=fraction cần Đáp án đúng dạng tử/mẫu, ví dụ 3/4.")
            return None
        parts = value.split("/")
        if len(parts) != 2:
            errors.append(f"Dòng {row_no}: Đáp án đúng \"{value}\" không đúng dạng tử/mẫu.")
            return None
        try:
            num, den = int(parts[0].strip()), int(parts[1].strip())
        except ValueError:
            errors.append(f"Dòng {row_no}: tử/mẫu trong \"{value}\" phải là số nguyên.")
            return None
        return {"kind": "fraction", "numerator": num, "denominator": den}
    if kind == "choice":
        if not value:
            errors.append(f"Dòng {row_no}: answerKind=choice cần Đáp án đúng.")
            return None
        opts = [o.strip() for o in (options or "").split(";") if o.strip()]
        if len(opts) < 2:
            errors.append(f"Dòng {row_no}: answerKind=choice cần ít nhất 2 Các lựa chọn, cách nhau bằng ;")
            return None
        if value not in opts:
            errors.append(f"Dòng {row_no}: Đáp án đúng \"{value}\" phải nằm trong Các lựa chọn ({options}).")
            return None
        return {"kind": "choice", "correct": value, "options": opts}
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    wb = load_workbook(args.xlsx, data_only=True)
    if "Câu hỏi" not in wb.sheetnames:
        print("Không tìm thấy sheet \"Câu hỏi\" trong file. Dùng đúng mẫu DayZi_Mau_Nhap_Cau_Hoi.xlsx.", file=sys.stderr)
        sys.exit(2)
    ws = wb["Câu hỏi"]
    headers = [norm(c.value) for c in ws[1]]
    col = {h: i for i, h in enumerate(headers)}

    all_expected_headers = list(REQUIRED_COLS.values()) + HINT_COLS + [
        "Đáp án đúng (answerValue)*", "Dung sai (tolerance)",
        "Các lựa chọn (options, cách nhau bằng ;)", "Mã dạng bài (problemTypeId)",
    ]
    missing_headers = [h for h in all_expected_headers if h not in col]
    if missing_headers:
        print("File không đúng mẫu — thiếu cột:", ", ".join(missing_headers), file=sys.stderr)
        sys.exit(2)

    errors = []
    items = []
    for r_i, row in enumerate(ws.iter_rows(min_row=2), start=2):
        vals = [norm(c.value) for c in row]
        get = lambda header: vals[col[header]] if col[header] < len(vals) else ""

        skill_id = get(REQUIRED_COLS["skillId"])
        prompt = get(REQUIRED_COLS["prompt"])
        # a fully blank row = end of anh's real content, skip silently
        if not skill_id and not prompt:
            continue

        row_errors = []
        k = get(REQUIRED_COLS["knowledgeLevel"])
        t = get(REQUIRED_COLS["thinkingLevel"])
        kind = get(REQUIRED_COLS["answerKind"])
        solution = get(REQUIRED_COLS["workedSolution"])
        hints = [get(h) for h in HINT_COLS]

        if not skill_id:
            row_errors.append(f"Dòng {r_i}: thiếu Mã kỹ năng.")
        if not prompt:
            row_errors.append(f"Dòng {r_i}: thiếu Đề bài.")
        if k not in VALID_K:
            row_errors.append(f"Dòng {r_i}: Mức kiến thức \"{k}\" không hợp lệ (phải là K0-K5).")
        if t not in VALID_T:
            row_errors.append(f"Dòng {r_i}: Mức tư duy \"{t}\" không hợp lệ (phải là T1-T5).")
        if kind not in VALID_KIND:
            row_errors.append(f"Dòng {r_i}: Dạng đáp án \"{kind}\" không hợp lệ (exact/numeric/fraction/choice/reasoning).")
        if not solution:
            row_errors.append(f"Dòng {r_i}: thiếu Lời giải đầy đủ.")
        if any(not h for h in hints):
            missing_n = [i + 1 for i, h in enumerate(hints) if not h]
            row_errors.append(f"Dòng {r_i}: thiếu Gợi ý số {', '.join(map(str, missing_n))} (cần đủ cả 6).")

        answer_spec = None
        if kind in VALID_KIND:
            answer_spec = build_answer_spec(
                kind, get("Đáp án đúng (answerValue)*"),
                get("Dung sai (tolerance)"), get("Các lựa chọn (options, cách nhau bằng ;)"),
                r_i, row_errors,
            )

        if row_errors:
            errors.extend(row_errors)
            continue

        problem_type_id = get("Mã dạng bài (problemTypeId)")
        items.append({
            "skillId": skill_id,
            **({"problemTypeId": problem_type_id} if problem_type_id else {}),
            "knowledgeLevel": k,
            "thinkingLevel": t,
            "prompt": prompt,
            "answerSpec": answer_spec,
            "hints": hints,
            "workedSolution": solution,
            "origin": "authored",
        })

    if errors:
        print(f"❌ {len(errors)} lỗi — sửa trong Excel rồi chạy lại:\n")
        for e in errors:
            print(" -", e)
        if not items:
            sys.exit(1)
        print(f"\n({len(items)} dòng hợp lệ vẫn được xuất ra bên dưới; sửa lỗi rồi chạy lại để lấy đủ.)")

    out_path = args.out or (args.xlsx.rsplit(".", 1)[0] + ".raw.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"\n✅ Đã đọc {len(items)} câu hợp lệ → {out_path}")
    print("Bước tiếp theo: node scripts/import-questions.mjs " + out_path)


if __name__ == "__main__":
    main()
