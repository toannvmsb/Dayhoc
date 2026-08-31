# 05 — API Contract Plan

> Authority: Technical Spec §10, §11. Nguyên tắc: **API-first, typed contract chia sẻ client↔server, role-based projection (child-safe ở server).**

---

## 1. Contract strategy

- Một nguồn contract duy nhất trong `/packages/api-contract` (OpenAPI hoặc tRPC + Zod).
- **Boundary validation:** mọi request/response validate bằng Zod schema (`/packages/schemas`).
- **Projection ở server:** mỗi resource có projector `toParentView / toChildView / toTeacherView`. Child **không bao giờ** nhận gap score / analytics từ API.
- Versioned: prefix `/v1`.

---

## 2. API surface (nhóm theo Tech Spec §10)

| Nhóm | Endpoints (ví dụ) |
|---|---|
| **Auth/Profile** | `POST /auth/*` · `GET/POST /families` · `GET/POST /children` · `POST /teacher-invites` |
| **Context** | `GET/PUT /children/{id}/learning-context` · `POST /teacher-contributions` · `POST /uploads` |
| **Twin** | `GET /children/{id}/twin` · `GET /children/{id}/skills/{skillId}/state` |
| **Gap** | `GET /children/{id}/gaps` · `POST /children/{id}/diagnostics` · `GET/POST /children/{id}/prescriptions` |
| **Planning** | `GET /children/{id}/daily-plan` · `GET /children/{id}/weekly-plan` · `GET /children/{id}/revision-plan` |
| **Practice** | `GET /assignments/{id}` · `GET /items/{id}` · `POST /items/{id}/hints` · `POST /submissions` |
| **Assessment** | `POST /assessments` · `POST /assessments/scan-test` · `GET /assessments/{id}/results` |
| **Reports** | `GET /children/{id}/weekly-report` · `GET /children/{id}/progress` |
| **Admin/Core** | `GET /curriculum` · `GET /skills` · `GET /problem-types` · `POST /golden-tests/run` |

---

## 3. Role-based projection (Tech Spec §11)

### Parent projection
Full child learning summary: learning context, twin (skill/problem-type/thinking), gaps + prescriptions, daily/weekly/revision plan, reports, controls (Theo đề xuất / Nhẹ hơn / Tăng cường / Để sau).

### Child projection (child-safe, server-enforced)
Chỉ: `ordered tasks + content + hints + direct feedback`.
**Loại bỏ tại server:** gap score, mastery numbers, priorities, analytics, parent controls, ranking.

```jsonc
// GET /children/{id}/today  (child token)
{
  "date": "2026-08-30",
  "tasks": [
    { "assignmentId": "...", "title": "Ôn quy đồng mẫu số",
      "estimatedMinutes": 8, "kind": "review" },
    { "assignmentId": "...", "title": "Thử thách hôm nay",
      "estimatedMinutes": 7, "kind": "challenge" }
  ]
  // KHÔNG có gapScore, mastery, priority, analytics
}
```

### Teacher projection
Chỉ context của child/class được mời, đủ để thêm learning update. Minimal analytics ở MVP.

---

## 4. Representative request/response shapes

### 4.1 Scan → AI confirmation (Capability 01/06)
```jsonc
// POST /uploads  → tạo upload + signed URL
// POST /assessments/scan-test { uploadId }
// → trả CANDIDATE để parent CONFIRM (không tự ghi evidence)
{
  "assessmentId": "...",
  "status": "needs_confirmation",
  "candidates": [
    { "skillId": "M4.FRAC.COMMON_DENOM", "problemTypeId": "P3",
      "knowledgeLevel": "K2", "thinkingLevel": "T2",
      "detectedDate": "2026-08-29", "source": "notebook_scan",
      "confidence": 0.71, "explanation": "Nhận diện quy đồng mẫu số" }
  ],
  "editable": true
}
// POST /assessments/{id}/confirm { edits[] } → mới ghi Evidence (append-only)
```

### 4.2 Daily plan (Capability 03)
```jsonc
// GET /children/{id}/daily-plan?minutes=25   (parent token)
{
  "availableMinutes": 25,
  "mix": { "school": 8, "gapRepair": 7, "advanced": 5, "thinking": 5 },
  "orderedActions": [
    { "type": "close_gap", "skillId": "M4.FRAC.EQUIVALENT",
      "reason": "Root gap chặn quy đồng mẫu số", "minutes": 7,
      "evidenceRefs": ["ev_123"] }
  ]
}
```

### 4.3 Gap + prescription (Capability 06)
```jsonc
// GET /children/{id}/gaps  (parent)
{ "gaps": [ {
  "id": "gap_1", "skillId": "M4.FRAC.COMMON_DENOM", "type": "prerequisite_gap",
  "rootSkillId": "M4.FRAC.EQUIVALENT", "priorityBand": "high",
  "whyExplanation": "Con làm sai quy đồng vì phân số tương đương chưa chắc",
  "lifecycleState": "CONFIRMED",
  "prescription": { "sessions": 3, "minutesPerSession": 15,
                    "dose": {"foundation":6,"standard":5,"application":3,"thinking":2},
                    "retestItems": 5, "retentionCheckDays": 7 },
  "parentOptions": ["follow","lighter","intensify","later"]
} ] }
```

### 4.4 Submission → evidence
```jsonc
// POST /submissions { assignmentId, questionId, answer, hintsUsed, reasoningText, timeSpent }
// → 202 { submissionId, evidenceId, feedback: <child-safe> }
```

---

## 5. Contract rules

1. Mọi endpoint khai báo **request + response Zod schema**; reject nếu invalid.
2. Endpoint trả field nhạy cảm phải đi qua projector theo token role — **default deny** cho child (type + `assertChildSafe` + route gate). Child token không bao giờ thấy analytics, mastery, gap, family settings, consent, billing.
3. AI-derived data luôn kèm `{ confidence, source, aiInferenceId }` để UI hiển thị review path.
4. Không đưa PII/child data vào URL/query string. Upload dùng signed expiring URL, **không public URL**.
5. Idempotency key cho submission & scan (tránh double-write evidence).
6. Errors: shape thống nhất `{ code, message, retryable }`; hỗ trợ offline queue cho submission.

---

## 6. Data-subject rights — parent-only, family-scoped (Privacy Architecture §7)

| Endpoint | Việc |
|---|---|
| `POST /children/{id}/data-export` | Xuất toàn bộ dữ liệu trẻ (mọi category §4) dạng machine-readable |
| `DELETE /children/{id}/uploads` | Xoá ảnh/PDF đã upload (giữ evidence đã trích) |
| `DELETE /children/{id}/learning-history` | Xoá attempts / evidence / twin / gaps |
| `DELETE /children/{id}` | Full erasure — chạy `deletion_jobs` workflow (SLA ≤ 72h) |
| `POST /children/{id}/consent/withdraw` | Rút consent theo category/purpose/processor (ghi row `consent_records` mới) |
| `POST /children/{id}/processing/stop` | Dừng AI job + recompute cho trẻ |

Mọi op ghi `rights_requests` (⊕) + audit log. `DELETE /children/{id}` không phải
soft-delete — trigger workflow §8 của Privacy Architecture.
