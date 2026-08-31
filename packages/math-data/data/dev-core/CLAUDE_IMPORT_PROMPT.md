# PROMPT CHO CLAUDE CODE — IMPORT MATH DEV CORE

Hãy đọc toàn bộ thư mục `AI_Parent_Learning_Copilot_Math_Dev_Core_v1.0/`.

Đây là dữ liệu Math Core dev-ready ban đầu cho Grade 4 và Grade 7.

Yêu cầu:

1. Không tự thay đổi hoặc tạo production Skill ID ngoài các file YAML.
2. Tạo schema validation cho tất cả YAML.
3. Validate:
   - unique IDs;
   - prerequisite reference tồn tại;
   - prerequisite graph không có cycle;
   - curriculum chỉ map tới skill tồn tại;
   - problem type IDs không trùng.
4. Tách rõ:
   - Standard Curriculum;
   - Actual Taught Curriculum;
   - Personalized Development Curriculum.
5. Không suy luận Child Mastery từ school grade.
6. Grade 7 `M7.*` hiện là `provisional_normalization`; không tự chuyển thành `production_final`.
7. Thiết kế loader/importer deterministic.
8. Viết automated tests cho validation.
9. Chưa sinh bài tập hoặc gọi LLM trong bước import dữ liệu này.

Sau khi hoàn thành:
- báo cấu trúc DB/domain mapping;
- báo validation result;
- báo ID/reference lỗi nếu có;
- báo các điểm cần content review;
- DỪNG và chờ phê duyệt trước khi nối Math Core vào Learning Twin/Gap Engine.
