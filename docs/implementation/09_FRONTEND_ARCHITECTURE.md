# 09 — Frontend Architecture

> **⚠ Một phần bị SUPERSEDED bởi Architecture Migration v1.1 (AI-Generation-First — chờ anh duyệt).** Xung đột + luật mới: `docs/implementation/12`–`17`. Doc này sẽ được cập nhật khi migration được APPROVE.

> Authority: UI/UX Spec. **Parent-first.** Child nhận **child-safe projection từ API** (không chỉ ẩn field ở UI). Cross-platform: web + iOS + Android chia sẻ contract, tokens, state machines.

---

## 1. UX North Star & principles

- **Parent-first, calm, actionable** — mỗi màn trả lời "Bây giờ tôi cần làm gì?".
- Action over analytics · Progress without pressure · Explain AI (lý do + evidence source) · **One primary CTA per screen** · Parent controls, AI proposes, child thinks · Accessibility (không phụ thuộc màu để truyền trạng thái).

---

## 2. Information Architecture theo role

| Parent | Child | Teacher |
|---|---|---|
| Home | Hôm nay | Hôm nay dạy gì |
| Con / Profiles | Ôn tập | Cập nhật bài đã dạy |
| Kế hoạch | Bài tập | Homework |
| Tiến bộ | Thử thách | Lịch kiểm tra |
| Scan / Cập nhật | Kết quả | Lớp/HS được mời |
| Báo cáo · Cài đặt | — | Cài đặt |

Nav: Parent mobile bottom nav = **Hôm nay • Con • Scan/Update • Tiến bộ • Thêm** (web = left rail cùng taxonomy). Child nav **tối đa 4 mục**.

---

## 3. Shared frontend strategy

```
/packages/api-client      typed client (web+mobile)
/packages/schemas         Zod — validate ở boundary
/packages/design-tokens   color/spacing/radius/type/elevation
/packages/ui-core         headless logic/state machines (hint ladder, scan flow,
                          plan session, gap decision) — không phụ thuộc render
/apps/web   (Next.js)     render web
/apps/mobile (Expo/RN)    render native
```
Chia sẻ: **contract + validation + tokens + state machines**. Render component riêng theo platform nhưng cùng state machine (vd HintStepper, ScanFlow).

---

## 4. Parent surface (priority 1)

**P02 Home** — required blocks (UI/UX §5): Child switcher · Learning Context (đang học gì + nguồn) · Today Plan (tổng phút + School/Gap/Advanced/Thinking) · Attention (gap ưu tiên/lịch thi/evidence mới) · Progress (1–3 insight) · Thinking Challenge.

Key screens: P01 Onboarding · P04 Learning Context · P05 Scan/Upload · **P06 AI Confirmation** · P07 Daily Plan · P08 Teach Me in 3 Minutes · P09 Teaching Session · P10 Twin/Progress · P11 Gap Detail · P12 Prescription · P13 Exam/Revision · P14 Weekly Report · P15 Notifications · P16 Settings/Permissions.

Flow bắt buộc:
- **Scan/Update:** một entry "Cập nhật việc học" → 5 lựa chọn (chụp bài tập/vở/kiểm tra/tin nhắn GV/nhập trực tiếp) → **luôn có confirmation screen** (skill/ngày/nguồn/confidence + Sửa) trước khi ghi Evidence.
- **Gap & Prescription:** mỗi gap là card (tên skill, ưu tiên, "Vì sao app nghĩ vậy?", ảnh hưởng, prescription x phiên × y phút, lifecycle) + lựa chọn **Theo đề xuất / Nhẹ hơn / Tăng cường / Để sau**.
- **Progress:** skill map theo domain (không một điểm tổng); Current vs Target; tách Knowledge/Problem Types/Thinking; Frontier chỉ dạng insight.

---

## 5. Child surface (priority 2) — strict minimal

Nav tối đa 4: **Hôm nay • Ôn tập • Bài tập • Thử thách**. Bảng must / must-NOT:

| Screen | Must show | Must NOT show |
|---|---|---|
| Hôm nay | 1–3 việc, thời lượng, Start | gap score, parent controls, ranking |
| Bài tập | câu hỏi, input, submit, hint | analytics phức tạp |
| Ôn tập | các set được giao | curriculum dashboard |
| Thử thách | 1 challenge, reasoning prompt | competition pressure |
| Kết quả | đúng/sai phù hợp, giải thích, bước tiếp | mastery score kỹ thuật |

- One question / focused step per viewport (mobile).
- Math input: phân số, biểu thức, lựa chọn, text reasoning, upload ảnh bài làm.
- Hint ladder: gợi ý định hướng → câu hỏi dẫn → ví dụ đơn giản → solution cuối khi cần.
- Sau bài tư duy hỏi "Con đã nghĩ theo cách nào?". **Không** streak/ranking ở MVP.

> **Child-safe là contract, không phải CSS:** Child app chỉ gọi child projection endpoints; token child bị server từ chối field nhạy cảm. UI không có đường nào lộ gap/mastery.

---

## 6. Teacher surface (priority 3) — lightweight

Flow < 60s: chọn lớp/HS được mời → tick bài/chủ đề đã dạy → tick dạng bài → thêm homework (text/ảnh) → thêm lịch/phạm vi KT → Submit. Không yêu cầu xem Twin/Gap.

---

## 7. Core components (UI/UX §16)

ChildSwitcher · LearningContextCard · TodayPlanCard · TimeBudgetSelector · GapCard · PrescriptionCard · SkillProgressRow · FrontierInsight · EvidenceChip · ExamCountdown · ScanUploader · AIConfidenceReview · WorksheetCard · HintStepper · ReasoningInput · TeacherQuickUpdate · EmptyState · ErrorState · OfflineState.

## 8. State design (UI/UX §17)

Loading (skeleton) · Empty (giải thích + CTA) · Low confidence (AI chưa chắc + confirm) · Conflict (2 nguồn context → parent review) · No internet (cached assignment + queue submission) · AI failure (fallback không mất evidence) · **No plan needed** (nói rõ hôm nay không cần thêm bài).

## 9. Responsive & tone

- Mobile: bottom nav, single-column, sticky CTA, camera-first scan. Tablet: split view teaching/worksheet. Web: left rail, 2-column parent dashboard, không nhồi analytics.
- Content tone (UI/UX §20): "Con đang cần củng cố quy đồng mẫu số" thay vì "Con yếu phân số"; "AI đề xuất — bố mẹ chọn" thay vì "AI quyết định".

## 10. Locked UX acceptance (UI/UX §23)

1. Parent từ Home → bắt đầu buổi học ≤ 3 thao tác (happy path).
2. Cập nhật "hôm nay con học gì" (manual/scan) dễ tìm từ Home.
3. Teacher cập nhật ~1 phút.
4. Child **không** thấy Gap Score / parent dashboard.
5. Mọi AI inference quan trọng có source/confidence/review path.
6. Không màn nào lấy school-grade làm trần nội dung.
7. Exam flow chạy được kể cả khi chỉ biết ngày thi + recent context.
