# 01 — Project Understanding

> **⚠ Một phần bị SUPERSEDED bởi Architecture Migration v1.1 (AI-Generation-First — chờ anh duyệt).** Xung đột + luật mới: `docs/implementation/12`–`17`. Doc này sẽ được cập nhật khi migration được APPROVE.

> Tài liệu này xác nhận sự hiểu của Lead Architect về sản phẩm **AI Parent Learning Copilot** trước khi viết code.
> Nguồn sự thật: `File du an/` (DEV CORE README, Product Blueprint, Technical Spec, UI/UX Spec, Math Core Grade 4, Math Core Grade 7).

---

## 1. Sản phẩm là gì

AI Parent Learning Copilot là **trợ lý học tập AI dành cho BỐ MẸ** có con học Toán (tiểu học → THCS). MVP triển khai trên **Web + iOS + Android**, pilot sâu ở **lớp 4** và **lớp 7**.

Nó **KHÔNG** phải:
- một ngân hàng câu hỏi (question bank),
- một AI gia sư chung chung (generic AI tutor),
- một LMS / hệ quản lý học tập nhà trường.

**Product thesis:** App không thay bố mẹ dạy con. App loại bỏ phần **chuẩn bị – phân tích – soạn luyện tập** vốn tốn thời gian của bố mẹ, để mỗi phút bố mẹ bỏ ra tạo ra tiến bộ học tập được xác thực.

---

## 2. Sản phẩm phục vụ ai

| Vai trò | Quan hệ | Vai trò trong MVP |
|---|---|---|
| **Parent (Bố mẹ)** | Người dùng chính (primary user) | Quản lý hồ sơ con, cập nhật learning context, xem Twin/Gap, duyệt plan, dạy cùng con, nhận report |
| **Child (Con)** | Người thụ hưởng (beneficiary) | Nhận task hôm nay, làm bài, ôn tập, thử thách, nhận hint + kết quả trực tiếp |
| **Teacher (Giáo viên)** | Cộng tác viên tùy chọn (optional contributor) | Tick nội dung đã dạy, dạng bài, homework, lịch/phạm vi kiểm tra |

---

## 3. Core problem

Bố mẹ muốn giúp con học hiệu quả nhưng thường **không biết**:
- con đang học gì ở trường,
- con thực sự hiểu gì,
- gap kiến thức nằm ở đâu,
- cần ôn lại gì,
- nên cho bài nâng cao nào,
- giải thích bài học ra sao,
- cho học thêm bao nhiêu là vừa,
- ôn gì trước kỳ thi.

→ Sản phẩm phải **tối thiểu hóa thời gian chuẩn bị của bố mẹ** trong khi **tối đa hóa tiến bộ học tập được xác thực của con**.

---

## 4. Vì sao Parent là primary user

- Bố mẹ là người **có động lực, có quyền quyết định** và có mặt thường xuyên bên con ở nhà.
- Bố mẹ cần thông tin để **hành động**, không cần phân tích học thuật.
- Con cần trải nghiệm **tối giản, task-first** — không nên chịu áp lực phân tích/điểm số.
- Giáo viên **có thể không tham gia** → sản phẩm không được phụ thuộc vào teacher adoption.

Nguyên tắc UX: **Parent controls; AI proposes; Child thinks.**

---

## 5. Vai trò Teacher trong MVP

Teacher là **optional**. Flow mục tiêu **< 60 giây**:
1. Chọn lớp/học sinh được mời.
2. Tick chủ đề/bài đã dạy hôm nay.
3. Chọn 1–n dạng bài.
4. Thêm homework (text/ảnh).
5. Thêm lịch/phạm vi kiểm tra nếu có.

Parent có thể nhập thay teacher. **App phải hoạt động đầy đủ ngay cả khi không có teacher.**

---

## 6. Giới hạn UI của Child (bắt buộc)

Child UI chỉ gồm tối đa 4 mục điều hướng: **Hôm nay • Ôn tập • Bài tập • Thử thách** (+ Hint, + Kết quả trực tiếp).

**Tuyệt đối KHÔNG hiển thị cho Child:**
- Gap Score,
- parent analytics / decision dashboard,
- mastery charts phức tạp,
- ranking / competitive pressure,
- learning analytics không cần thiết.

Child chỉ cần trả lời một câu: **"Bây giờ con cần làm gì?"**

→ Child nhận **child-safe projection từ API**, không chỉ ẩn field ở UI.

---

## 7. Bảy capability của MVP (LOCKED)

| # | Capability | Câu hỏi sản phẩm trả lời |
|---|---|---|
| 01 | **Learning Context** | Con thực tế đang học gì? |
| 02 | **Child Learning Twin** | Con thực sự đã biết gì và ở mức nào theo từng skill? |
| 03 | **Daily Learning Plan** | Hôm nay nên học gì với thời gian hiện có? |
| 04 | **Parent Teaching Copilot** | Bố mẹ nên giải thích, hỏi và hint thế nào? |
| 05 | **Adaptive Practice & Thinking** | Nên luyện dạng nào để chắc, sâu, phát triển tư duy? |
| 06 | **Assessment & Gap Diagnosis** | Con sai vì đâu; root gap nào xử lý trước? |
| 07 | **Learning & Revision Engine** | Ngày/tuần tới và trước kỳ thi phân bổ ra sao? |

Không thêm feature lớn ngoài 7 capability này nếu chưa được duyệt.

---

## 8. Educational Intelligence Model (NON-NEGOTIABLE)

### 8.1 Bất biến cốt lõi
> **School grade là context, không phải trần năng lực (`school_grade ≠ learning_level`).**

Một học sinh lớp 7 có thể đang học kiến thức lớp 8/9/HSG ở một số skill, đồng thời vẫn hổng prerequisite ở skill sớm hơn.

### 8.2 Chuỗi suy luận
```
Curriculum → Skills → Prerequisites → Problem Types → Knowledge Level → Thinking Level
→ Evidence → Mastery → Knowledge Gap → Learning Readiness → Learning Prescription
→ Next Best Learning Action
```

### 8.3 Core loop
```
Evidence → Learning Context → Child Learning Twin → Gap / Root Cause → Readiness
→ Learning Prescription → Learning Plan → Adaptive Practice → Assessment → Evidence
→ Update Twin
```

### 8.4 Ba lớp curriculum
1. **Standard Curriculum** — SGK / chương trình chuẩn.
2. **Actual Taught Curriculum** — thực tế giáo viên / lớp nâng cao đang dạy.
3. **Personalized Development Curriculum** — AI đề xuất từ Twin + Gap + Readiness + mục tiêu + thời gian.

### 8.5 Ba lớp mục tiêu học
- **HỌC CHẮC** — chắc kiến thức chuẩn, không hổng prerequisite.
- **HỌC SÂU** — hiểu bản chất, vận dụng, kết nối.
- **HỌC CAO** — phát triển tư duy, HSG, competition readiness.

Nguyên tắc: **Nâng cách suy nghĩ trước khi nâng kiến thức.**

### 8.6 Hai trục độ khó độc lập
- **Knowledge Level K0–K5** (prerequisite_gap → competition).
- **Thinking Level T1–T5** (recall/execute → non-routine).
- Một bài lớp 4 chỉ dùng kiến thức lớp 4 vẫn có thể yêu cầu Thinking Level **T5**. **Không đánh đồng "nâng cao" = "lớp cao hơn".**

---

## 9. Grade 4 pilot

Kiểm chứng: **standard curriculum → advanced practice → thinking development.**
Nguồn: SGK Toán 4 Kết nối tri thức Tập 1–2 + lộ trình nâng cao 36 tuần + bộ bài tập nâng cao benchmark.
Skill ID prefix hiện tại trong nguồn: `M4.*`.

## 10. Grade 7 cross-grade pilot

Kiểm chứng: **cross-grade learning → G8/G9 exposure → advanced algebra → HSG reasoning → prerequisite gap repair.**
Nguồn: SGK Toán 7 Kết nối tri thức Tập 1–2 + bài thực tế 13/8 & 15/8 + tài liệu "Biến đổi đồng nhất" (đến HSG lớp 9 Hà Nội 2018).
Skill ID prefix hiện tại trong nguồn: `G7.*`.

> ⚠️ Kiến trúc **không được hard-code** riêng cho lớp 4 hoặc 7; phải mở rộng được Grade 1 → Grade 9.

---

## 11. Ngoài phạm vi MVP (Out of Scope)

- Tích hợp sâu School / LMS.
- Teacher analytics phức tạp.
- Social / leaderboard.
- Marketplace gia sư.
- Đa môn ngoài Toán.
- Gamification nặng (streak/ranking).
- School administration.

---

## 12. North Star & Definition of Done

- **Learning North Star:** Verified Skills Mastered / Month.
- **Product North Star:** Parent Time → Child Progress.
- Không tối ưu screen time hay số lượng bài; tối ưu **tiến bộ xác thực trên mỗi phút học**.

**DoD MVP:** Parent tự thiết lập context không cần teacher; Teacher cập nhật < 1 phút; Child chỉ thấy task; Engine hỗ trợ above-grade + parallel gap repair; **mọi khuyến nghị truy vết được về evidence/skill/gap/goal**; golden tests pass deterministic trong tolerance.
