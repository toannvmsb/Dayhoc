# Design System — "Hướng 1A · Bình tĩnh & ấm"

Source of truth: the Claude Design handoff in [`docs/design/handoff/`](../design/handoff/) +
UI/UX Design Spec v1.0. Anh chose **Hướng 1A** ("Bình tĩnh & ấm") from the three
directions — cream surface, teal primary, `Plus Jakarta Sans`, single-column card
stacks, Today Plan as a proportional mix bar.

> This document is the **design foundation**. Actual screen implementation happens in
> **Phase 6 (Parent)** → **Phase 7 (Child)** → **Phase 8 (Teacher)**, each behind the
> API projections from Phase 5 and gated by the Phase 4.5 Golden Gate. Building screens
> earlier would couple UI to engine internals that are still being calibrated.

---

## 1. Tokens

`@copilot/design-tokens` is the single source. Web imports `@copilot/design-tokens/css`
(CSS custom properties); React Native imports the `tokens` object.

| Group | Notes |
|---|---|
| `color` | Warm neutrals (`bg #FFFBF5`, `surface #FFF`, `surfaceSubtle #F4F0E8`), teal primary family (`#0E9384 / #0B6E62 / #08544B`), amber attention family, two dark surfaces for scan + child challenge. |
| `learningMix` | The 4 Today-Plan dimensions — `school / gapRepair / advanced / thinking` — each with an `onLight` and `onPrimary` variant. Order matches domain `LEARNING_MIX_DIMENSIONS`. |
| `font` | `Plus Jakarta Sans`; separate `child*` size ramp (Child = larger type, one task per view). |
| `space` | 4px base. `radius` chip→sheet. `elevation` border-led; shadows only for lifted surfaces. |
| `hit` | `ctaHeightParent 54`, `ctaHeightChild 58`, `inputHeight 52`, `minTarget 44` (a11y). |

**Status is never color-only** (UI/UX Spec §2). Each status token bundles bg + text + is
paired in components with an icon or label.

---

## 2. Screen inventory → capability → role

Screen IDs follow the handoff (`docs/design/handoff/mobile-390.dc.html`, `web-1440.dc.html`).
"Cap." = which of the 7 MVP capabilities the screen serves.

### Account & roles (all platforms)
| ID | Screen | Role | Cap. |
|---|---|---|---|
| A01 | Chọn vai trò | — | — |
| A02 | Đăng ký bố mẹ (3 bước) | Parent | — |
| A03 | Tạo profile con & mục tiêu & phút/ngày | Parent | Learning Context |
| A04 | Đăng nhập · tab 3 role · **PIN 4 số** cho con · mã lớp giáo viên | all | — |

### Parent (priority 1 — Phase 6)
| ID | Screen | Cap. |
|---|---|---|
| P02 | Home — child switcher, Learning Context, Today Plan mix bar, Attention, Progress, Challenge | Daily Plan + Twin |
| P05 | Cập nhật việc học — 1 entry, 5 nguồn (bài tập / vở / kiểm tra / tin nhắn GV / nhập-nói) | Learning Context |
| P06 | AI nhận diện → **bố mẹ xác nhận** (môn/chủ đề/dạng/ngày/nguồn + confidence + "một phần chưa chắc") | Assessment + Context |
| P07 | Kế hoạch hôm nay — time-budget selector, 4 bước, "Vì sao app đề xuất?" | Daily Plan |
| P08 | Dạy con trong 3 phút — mục tiêu · bản chất · câu hỏi mở đầu · lỗi thường gặp · hint ladder | Parent Teaching Copilot |
| P09 | Buổi học đang diễn ra — step timer, câu hỏi cho con, hint ladder, chấm nhanh, "bước này thế nào" | Parent Teaching Copilot |
| P10 | Tiến bộ — tabs Kiến thức / Dạng bài / Tư duy, current-vs-target bars, evidence timeline, Frontier insight | Child Learning Twin |
| P11 | Chi tiết điểm cần củng cố — "Vì sao app nghĩ vậy?", ảnh hưởng tới, lifecycle strip | Assessment & Gap Diagnosis |
| P12 | Đề xuất xử lý — x phiên × y phút, nội dung mỗi phiên, **Theo đề xuất / Nhẹ hơn / Tăng cường / Để sau** | Learning & Revision Engine |
| P13 | Ôn thi — countdown, scope inference + parent confirm, priority ôn, đề ôn thử | Learning & Revision Engine |
| P14 | Báo cáo tuần — KPIs, tiến bộ, cần theo tiếp, đề xuất phân bổ tuần tới | Learning & Revision Engine |
| (P15 Notifications, P16 Settings/Permissions — spec §15, screens TBD in Phase 6/9) |

### Child (priority 2 — Phase 7, from **child-safe projection**)
| ID | Screen | Must NOT show |
|---|---|---|
| C02 | Hôm nay — 1–3 việc, thời lượng, "Bắt đầu", nav 4 mục | gap score, parent dashboard, ranking |
| C03 | Làm bài — one question / viewport, math input (phân số, √, x², chụp bài làm) | analytics |
| C04 | Gợi ý theo bậc — định hướng → câu hỏi dẫn → ví dụ đơn giản → lời giải cuối | mastery score |
| C06 | Thử thách — 1 bài suy luận, ô "Con nghĩ thế nào?", "Gửi cách nghĩ" | competition pressure |
| C07 | Kết quả — đúng/sai phù hợp, xem lại các bước, **"Con đã nghĩ theo cách nào?"** | technical mastery |
| (C05 Review — assigned sets; Phase 7) |

### Teacher (priority 3 — Phase 8, goal < 60s)
| ID | Screen |
|---|---|
| T02 | Hôm nay dạy gì — "chưa cập nhật buổi …", lớp của bạn, lịch sử gần đây |
| T03 | Cập nhật bài đã dạy — 1·chủ đề · 2·dạng bài · 3·bài về nhà (ảnh/nói) · 4·lịch kiểm tra |
| W02 | Teacher quick update (web) — same flow, class picker rail |

### Web desktop (1440)
| ID | Screen |
|---|---|
| W01 | Parent dashboard — left rail (same taxonomy as mobile nav), 2-column, no analytics dump |
| W02 | Teacher quick update |

---

## 3. Core components (UI/UX Spec §16)

`ChildSwitcher` · `LearningContextCard` · `TodayPlanCard` (+ `LearningMixBar`) ·
`TimeBudgetSelector` · `GapCard` · `PrescriptionCard` (with the 4 parent options) ·
`SkillProgressRow` (current-vs-target) · `FrontierInsight` · `EvidenceChip` ·
`ExamCountdown` · `ScanUploader` · `AIConfidenceReview` · `WorksheetCard` ·
`HintStepper` · `ReasoningInput` · `TeacherQuickUpdate` · `EmptyState` · `ErrorState` ·
`OfflineState`.

Each ships variants for: **loading (skeleton) / empty / error / low-confidence / disabled**
(handoff checklist §22).

---

## 4. Non-negotiable UX rules (carried into component contracts)

1. **One primary CTA per screen** — a single `action.primary` emphasis.
2. **Explain AI** — every AI-derived card carries a reason + evidence source + a review path.
   Copy: "AI đề xuất — bố mẹ chọn", never "AI quyết định".
3. **Parent → start a session ≤ 3 taps** on the happy path.
4. **No screen uses school grade as a content ceiling.**
5. **Child gets a server-side child-safe projection**, not client-hidden Parent fields —
   the child token is *rejected by the API* for gap score / mastery / ranking fields.
6. **Content tone** (§20): "Con đang cần củng cố quy đồng mẫu số" not "Con yếu phân số";
   "Chưa ổn định" not "Không đạt"; "Đang trên/đúng/dưới mức mục tiêu" not percentiles.
7. **Progress has no single overall score** — always split Knowledge / Problem Types / Thinking.

---

## 5. Platform split

| | Parent | Child | Teacher |
|---|---|---|---|
| Mobile | bottom nav (Hôm nay · Con · Cập nhật · Tiến bộ · Thêm), single column, sticky CTA, camera-first scan | bottom nav max 4 (Hôm nay · Ôn tập · Bài tập · Thử thách), one step per viewport | quick-update form first |
| Web 1440 | left rail (same taxonomy), 2-column dashboard | wide working area | quick-update form + class rail |
| Tablet | split view for teaching session / worksheet | — | — |

Fonts via Google Fonts (`Plus Jakarta Sans`) with a real fallback stack in tokens.
