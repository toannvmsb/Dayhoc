# AI Parent Learning Copilot — Math Dev Core v1.0

Bộ dữ liệu này được chuẩn hóa từ **Math Core Grade 4**, **Math Core Grade 7** và backbone SGK Toán Kết nối tri thức đã khóa trong dự án.

## Cấu trúc

```text
AI_Parent_Learning_Copilot_Math_Dev_Core_v1.0/
├── README.md
├── shared_taxonomy.yaml
├── grade4/
│   ├── curriculum.yaml
│   ├── skill_graph.yaml
│   ├── prerequisite_graph.yaml
│   └── problem_types.yaml
└── grade7/
    ├── curriculum.yaml
    ├── skill_graph.yaml
    ├── prerequisite_graph.yaml
    └── problem_types.yaml
```

## Cách Claude/dev phải dùng

1. `curriculum.yaml` = **Standard Curriculum**; không phải Child Mastery.
2. `skill_graph.yaml` = danh mục skill dùng để map Evidence.
3. `prerequisite_graph.yaml` = dependency graph để trace root gap/readiness.
4. `problem_types.yaml` = dạng bài; mastery của dạng bài phải tách khỏi mastery của skill.
5. `shared_taxonomy.yaml` = các invariant và K/T taxonomy dùng chung.

## Quy tắc bất biến

- `school_grade` chỉ là context, không phải ceiling.
- Không sinh bài chỉ dựa vào lớp.
- Không suy luận năng lực toàn cục từ một bài/đề.
- Không coi mọi câu sai là knowledge gap.
- Không đóng gap sau một câu đúng.
- `Knowledge Level` và `Thinking Level` độc lập.
- LLM không được tự tạo production Skill ID.
- Evidence phải audit được và không overwrite lịch sử.
- Grade 7 có thể chứa G8/G9/HSG exposure theo từng skill nhưng không tạo `global_grade_level = 9`.

## Trạng thái dữ liệu

### Grade 4
Skill IDs và nhiều prerequisite/problem types đã có trực tiếp trong Math Core v1.0, nên được đánh dấu `source_backed_initial_core`.

### Grade 7
Math Core v1.0 hiện định nghĩa **skill families/cross-grade paths** chứ chưa có full item-level production Skill IDs.
Các ID `M7.*` trong package này là **provisional normalization** dựa trực tiếp trên 37 tên bài SGK để dev có cấu trúc triển khai ban đầu.

**Không nên khóa các M7 ID này thành production-final trước khi review bởi người phụ trách nội dung Toán.**

## Quy trình nhập vào code

```text
Load YAML
→ schema validate
→ ensure unique IDs
→ validate all prerequisite refs
→ cycle detection on prerequisite DAG
→ load immutable curriculum/skill catalog
→ Evidence mapper only returns existing IDs
→ mastery/gap/readiness deterministic engine
```

## Acceptance checks

- YAML parse thành công.
- Không có duplicate Skill ID.
- Mọi prerequisite reference tồn tại.
- Prerequisite graph không có cycle.
- Curriculum mapping chỉ tham chiếu Skill ID tồn tại.
- LLM output không được phép thêm ID mới.
- Above-grade recommendation phải qua readiness check.

## Việc cần làm tiếp trước production

1. Giáo viên/chuyên gia Toán review item-level mapping Grade 7.
2. Bổ sung full prerequisite DAG xuyên lớp 1–9.
3. Chuẩn hóa problem type IDs cho toàn bộ skill.
4. Tạo golden questions cho mỗi skill/problem type.
5. Calibrate mastery/gap coefficients bằng dữ liệu học sinh thật.
