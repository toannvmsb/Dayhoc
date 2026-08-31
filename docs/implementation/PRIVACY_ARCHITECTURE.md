# Privacy & Child-Data Architecture

> **Authority:** anh's decision P-05 (2026-08-31). These principles are binding on
> the Technical Architecture, database model, API contracts, storage lifecycle and
> AI orchestration. Any module that touches child data is designed against this doc
> **before** implementation.
>
> Scope now: architecture must be *capable* of everything below. The final consent
> UI is a later deliverable — but no schema, contract or storage decision may
> foreclose these requirements.

Legal frame: **Privacy-by-Design**, aligned with Vietnam's Decree 13/2023/NĐ-CP on
personal data protection (children = data subjects requiring guardian consent).

---

## 1. Actors & ownership

| Actor | Role in the data model |
|---|---|
| **Parent / Legal Guardian** | Account owner. Creates the Child Profile. Holds and manages all consent and data-subject rights on the child's behalf. The only actor who can export/delete child data or withdraw consent. |
| **Child** | Data subject. Has a login (see §2) scoped to a child-safe surface. Cannot manage consent, family settings or billing. |
| **Teacher** | Optional contributor, invited per child/class. Sees only the minimal context needed to add a learning update. Never sees Twin, Gap, analytics, consent or billing. |

---

## 2. Authentication (revised — supersedes earlier "PIN login")

**Child login = username + password, created by the parent.** The child may change
their own password after first sign-in. This is a real credential, scoped to the
child-safe projection only.

**PIN (4-digit) is a convenience shortcut, not a login.** It opens *assigned work*
directly (the "làm bài bố mẹ giao" quick path) on a device where the child is
already known — it never authenticates a fresh session and never unlocks anything
beyond the assigned assignments.

| | Mechanism | Unlocks |
|---|---|---|
| Parent / Teacher | email + password (+ OTP option) | full role projection |
| Child — full session | username + password (parent-created, child-changeable) | child-safe projection |
| Child — quick access | 4-digit PIN on a recognised device | today's assigned assignments only |

DB impact: `child_credentials` (username, password hash, `must_change_password`,
`password_updated_at`) + `child_quick_access` (pin hash, device binding, scope =
assigned-work). See `04_DATABASE_MODEL.md §1`.

---

## 3. Consent — versioned, auditable, granular

No boolean `consent = true`. A dedicated `consent_records` ledger, append-only,
one row per consent event. Each row captures **at least**:

- `granted_by` — parent / legal representative (user id + relationship)
- `child_id`
- `data_categories` — which categories this consent covers (§4)
- `purpose` — processing purpose (learning diagnosis, practice generation, …)
- `processor` — internal / named AI or OCR provider
- `cross_border` — boolean + destination region if the processor is outside VN
- `policy_version` + `consent_text_version`
- `accepted_at`
- `withdrawn_at` (nullable)
- `method` — how it was captured (signup flow, settings screen, re-consent prompt)

Withdrawal writes a new row (`withdrawn_at` set); it never mutates the grant row.
Processing that depends on a withdrawn consent stops on the next job cycle.

---

## 4. Child data categories

Both **directly collected** and **inferred / AI-derived** data are child personal
data and fall under consent + deletion:

| Group | Examples |
|---|---|
| Profile & context | display name, school grade, school context, family goals, time budget |
| Uploaded schoolwork (raw) | photos/PDFs of homework, tests, notebooks; handwriting; images |
| Learning activity | attempts, submissions, hint usage, time spent |
| Derived learner state | Learning Evidence, Child Learning Twin, skill mastery, problem-type mastery, thinking profile, Knowledge Gaps, gap history, readiness |
| AI-derived insights | classifications, error diagnoses, parent-facing summaries, generated explanations tied to the child |

`assertChildSafe` (already in `@copilot/projections`) forbids the derived-state
keys from ever reaching a child token; this doc adds them to the retained/erasable
set for deletion.

---

## 5. Data minimization to AI / external processors

- An AI/OCR provider receives **only the minimum needed for the task**.
- **Never sent** to an external provider unless the task genuinely requires it:
  real name, address, school name, phone, full profile, family data.
- Identifiers passed to providers are opaque (`child_ref` hash), not the child id.
- School grade may be sent as *educational context* only; specific school/class
  name is not collected unless a feature needs it (§17 below → we don't).
- Implemented as `minimizeForProvider(payload, allowedCategories)` in `@copilot/ai`
  — strips disallowed fields, replaces identifiers, and is asserted in tests.

---

## 6. Storage lifecycle

| Data | Default retention | Notes |
|---|---|---|
| **Raw uploaded schoolwork** (images/PDFs) | **30 days**, configurable | After Vision/OCR → structured Learning Evidence succeeds, the raw object is eligible for automatic purge on the retention schedule. |
| Structured Learning Evidence, attempts, mastery, Twin, gap history | Life of the active Child Profile | Unless parent requests deletion / withdraws consent, or a stricter retention policy applies. |
| `consent_records`, audit logs, `data_processing_inventory` | Retained for the legally required audit period even after profile deletion, minimised (no learning content — just the record that processing/consent/deletion happened). |
| AI provenance (`ai_inferences`) | Tied to the evidence it produced — purged with that evidence in the deletion workflow. |

- **Every upload is private by default.** No public object URLs — signed, expiring
  URLs only, scoped to the requester's role + family.

---

## 7. Data-subject rights — backend capabilities (parent-initiated)

The backend must support, as first-class operations:

1. **Export child data** — machine-readable dump of all categories in §4.
2. **Delete uploaded images** — without deleting the derived evidence.
3. **Delete learning history** — attempts, evidence, twin, gaps.
4. **Delete Child Profile** — full erasure (§8).
5. **Withdraw consent** — per category/purpose/processor.
6. **Stop future processing** — halt AI jobs and recompute for the child.

Each is an endpoint under a `parent`-only, family-scoped route (`05_API_CONTRACT_PLAN.md §7`).

---

## 8. Delete Child Profile = real deletion workflow

Not a soft-delete flag. An ordered, auditable workflow:

```
1. flag child_id "deletion_requested" → stop new processing immediately
2. cancel / drain in-flight AI + OCR jobs for the child
3. delete raw uploads + storage objects
4. delete Learning Evidence + ai_inferences tied to it
5. delete attempts / submissions
6. delete Knowledge Gaps + gap lifecycle events
7. delete Child Learning Twin (derived — recompute source now gone)
8. delete AI-derived content (summaries, explanations) referencing the child
9. delete child_credentials + child_quick_access
10. trigger backup-deletion lifecycle (mark for purge from backups on their cycle)
11. write a deletion audit record (who, when, what categories) to the retained log
```

- **SLA target: complete within ≤ 72 hours** (system goal; final SLA follows the
  applicable legal requirement).
- The append-only rule on `evidence` / `teacher_contributions` is an
  **audit/compute invariant for the lawful lifetime of the data** — it is *not* a
  mechanism to block erasure. The deletion workflow runs as a privileged operation
  that suspends the append-only triggers for its transaction (already prototyped:
  `SET session_replication_role = replica`), performs the ordered deletes, and
  records the erasure.

---

## 9. Child API projection — hard boundary

A child token's responses **never** include:
parent-only analytics, mastery/gap scores, family settings, consent management,
billing/subscription data, other children's data.

Enforced three ways (defense in depth):
1. type-level — `Child*View` shapes in `@copilot/api-contract` don't carry the fields;
2. `assertChildSafe` runtime guard on every child response (`@copilot/projections`);
3. route-level — child token can only reach `child*` handlers (`@copilot/api`).

---

## 10. AI provider registry — compliance metadata

`AIProviderAdapter` carries, per provider, a `ProviderCompliance` record:

- `provider` · `processing_region` · `cross_border` (bool)
- `data_categories_allowed` — which §4 categories may be sent to this provider
- `provider_retention` — how long the provider retains inputs
- `training_allowed` — whether inputs may be used for model training (**must be false** for child data)
- `dpa_status` — data-processing-agreement state (signed / pending / n-a)

The orchestrator refuses a call whose payload categories exceed
`data_categories_allowed`, and refuses any provider with `training_allowed = true`
for child-data operations.

---

## 11. Data Processing Inventory

`data_processing_inventory` table — one row per (data_category × purpose ×
processor × legal_basis × retention). Kept current so a Data Protection Impact
Assessment (đánh giá tác động xử lý dữ liệu cá nhân) can be produced later without
archaeology.

---

## 12. Security baseline

- **Encryption** in transit (TLS) and at rest (DB + object store).
- **RBAC + family scope** on every request; least privilege for services and jobs.
- **Private storage**, signed expiring URLs, no public buckets.
- **Audit logs** for: consent events, teacher updates, AI-derived state changes,
  every data-subject-rights operation, every deletion.
- **Secret management** outside source control.
- **PII minimization** end to end (§5).

---

## 13. What changes in the codebase now (architecture-capable, not full impl)

| Area | Change | Status |
|---|---|---|
| `04_DATABASE_MODEL.md` | add `consent_records`, `child_credentials`, `child_quick_access`, `data_processing_inventory`, `ai_provider_registry`, retention columns | doc + migration |
| Migration | `*_privacy_foundation` — the tables above | ✅ this change |
| `@copilot/ai` | `ProviderCompliance` type on adapters; `minimizeForProvider()` + tests | ✅ this change |
| `05_API_CONTRACT_PLAN.md` | §7 data-subject-rights endpoints; reinforce no-public-URL, default-deny | doc |
| `03_SYSTEM_ARCHITECTURE.md` | storage lifecycle box; deletion workflow; provider registry | doc |
| `06_AI_ORCHESTRATION_PLAN.md` | data minimization step before every provider call; `training_allowed=false` gate | doc |
| Consent UI, export/delete UI, backup-deletion automation | later deliverable | ⏳ |
