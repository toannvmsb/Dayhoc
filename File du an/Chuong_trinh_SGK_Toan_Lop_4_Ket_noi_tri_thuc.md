# CHƯƠNG TRÌNH TOÁN LỚP 4 --- KẾT NỐI TRI THỨC VỚI CUỘC SỐNG

**Mục đích:** Standard Curriculum cho Claude/dev của AI Parent Learning
Copilot.\
**Phạm vi:** SGK Toán 4 --- Tập 1 và Tập 2.\
**Lưu ý:** Chỉ chứa backbone SGK chuẩn; nội dung nâng cao/HSG phải lưu ở
lớp dữ liệu riêng.

## Quy tắc hệ thống

-   `school_grade: 4` là context, không phải trần năng lực.
-   Tách Standard Curriculum khỏi Actual Taught Curriculum và
    Personalized Development Curriculum.
-   Mỗi bài cần normalize thành `skill_id`, `problem_type`,
    `prerequisites`.
-   Không dùng chương trình lớp để suy luận mastery của học sinh.
-   Không để LLM tự tạo/sửa production Skill ID.

# TẬP 1

## Chủ đề 1 --- Ôn tập và bổ sung

-   Ôn tập các số đến 100 000
-   Ôn tập các phép tính trong phạm vi 100 000
-   Số chẵn, số lẻ
-   Biểu thức chữ
-   Giải bài toán có ba bước tính
-   Luyện tập chung

## Chủ đề 2 --- Góc và đơn vị đo góc

-   Đo góc, đơn vị đo góc
-   Góc nhọn, góc tù, góc bẹt
-   Luyện tập chung

## Chủ đề 3 --- Số có nhiều chữ số

-   Số có sáu chữ số, số 1 000 000
-   Hàng và lớp
-   Các số trong phạm vi lớp triệu
-   Làm tròn số đến hàng trăm nghìn
-   So sánh các số có nhiều chữ số
-   Làm quen với dãy số tự nhiên
-   Luyện tập chung

## Chủ đề 4 --- Một số đơn vị đo đại lượng

-   Yến, tạ, tấn
-   Đề-xi-mét vuông, mét vuông, mi-li-mét vuông
-   Giây, thế kỉ
-   Thực hành và trải nghiệm sử dụng một số đơn vị đo
-   Luyện tập chung

## Chủ đề 5 --- Phép cộng và phép trừ

-   Phép cộng các số có nhiều chữ số
-   Phép trừ các số có nhiều chữ số
-   Tính chất giao hoán và kết hợp của phép cộng
-   Tìm hai số biết tổng và hiệu của hai số đó
-   Luyện tập chung

## Chủ đề 6 --- Đường thẳng vuông góc. Đường thẳng song song

-   Hai đường thẳng vuông góc
-   Thực hành và trải nghiệm vẽ hai đường thẳng vuông góc
-   Hai đường thẳng song song
-   Thực hành và trải nghiệm vẽ hai đường thẳng song song
-   Hình bình hành, hình thoi
-   Luyện tập chung

## Chủ đề 7 --- Ôn tập học kì I

-   Ôn tập các số đến lớp triệu
-   Ôn tập phép cộng, phép trừ
-   Ôn tập hình học
-   Ôn tập đo lường
-   Ôn tập chung

# TẬP 2

## Chủ đề 8 --- Phép nhân và phép chia

-   Nhân với số có một chữ số
-   Chia cho số có một chữ số
-   Tính chất giao hoán và kết hợp của phép nhân
-   Nhân, chia với 10, 100, 1 000, ...
-   Tính chất phân phối của phép nhân đối với phép cộng
-   Nhân với số có hai chữ số
-   Chia cho số có hai chữ số
-   Thực hành và trải nghiệm ước lượng trong tính toán
-   Tìm số trung bình cộng
-   Bài toán liên quan đến rút về đơn vị
-   Luyện tập chung

## Chủ đề 9 --- Làm quen với yếu tố thống kê, xác suất

-   Dãy số liệu thống kê
-   Biểu đồ cột
-   Số lần xuất hiện của một sự kiện
-   Luyện tập chung

## Chủ đề 10 --- Phân số

-   Khái niệm phân số
-   Phân số và phép chia số tự nhiên
-   Tính chất cơ bản của phân số
-   Rút gọn phân số
-   Quy đồng mẫu số các phân số
-   So sánh phân số
-   Luyện tập chung

## Chủ đề 11 --- Phép cộng, phép trừ phân số

-   Phép cộng phân số
-   Phép trừ phân số
-   Luyện tập chung

## Chủ đề 12 --- Phép nhân, phép chia phân số

-   Phép nhân phân số
-   Phép chia phân số
-   Tìm phân số của một số
-   Luyện tập chung

## Chủ đề 13 --- Ôn tập cuối năm

-   Ôn tập số tự nhiên
-   Ôn tập phép tính với số tự nhiên
-   Ôn tập phân số
-   Ôn tập phép tính với phân số
-   Ôn tập hình học và đo lường
-   Ôn tập một số yếu tố thống kê và xác suất
-   Ôn tập chung

# DATA MODEL GỢI Ý CHO DEV

``` yaml
curriculum_item:
  id: M4.CURR.<stable_id>
  school_grade: 4
  volume: 1|2
  theme_id: 1..13
  theme_name: string
  lesson_name: string
  curriculum_origin: G4_STANDARD
  skill_ids: []
  prerequisite_skill_ids: []
  problem_type_ids: []
```

## Yêu cầu triển khai

1.  Normalize từng mục SGK thành skill nguyên tử.
2.  Gán stable Skill ID.
3.  Xây prerequisite DAG.
4.  Map Skill → Problem Type.
5.  Giữ Knowledge Level và Thinking Level độc lập.
6.  Nội dung nâng cao/HSG là extension, không ghi đè SGK chuẩn.
7.  Homework/test/scan mới quyết định Actual Learning Context.
