# 03 — System Architecture

> Authority: Technical Spec §1, §5, §6, §12. Nguyên tắc: **API-first, shared domain, role-based projection, deterministic core + replaceable AI.**

---

## 1. High-level topology

```
┌──────────────────────────────────────────────────────────────┐
│  CLIENTS (role-based projection)                              │
│  Web (Next.js/React/TS)   Mobile (React Native/Expo/TS)      │
│  Parent · Child · Teacher surfaces                           │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTPS / typed API client (shared contracts)
┌───────────────▼──────────────────────────────────────────────┐
│  API GATEWAY / BFF  (auth, RBAC, projection, rate limit)     │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│  MODULAR MONOLITH (TypeScript service layer)                 │
│                                                              │
│  ┌── Deterministic Education Core ──────────────────────┐    │
│  │ curriculum · skill_graph · prerequisite · evidence   │    │
│  │ mastery · gap · readiness · planning · revision      │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌── AI Orchestration (replaceable providers) ──────────┐    │
│  │ OCR/Vision · Classification · Generation · Explain   │    │
│  │  → all outputs pass JSON-schema validation           │    │
│  └──────────────────────────────────────────────────────┘    │
│  identity · family · teacher_contribution · practice ·       │
│  assessment · notifications · reporting                       │
└───────┬───────────────┬───────────────┬──────────────┬───────┘
        │               │               │              │
   PostgreSQL       Redis (cache/     S3-compatible   AI/OCR
   (source of       queue/jobs)       object store    providers
    truth +         background        (ảnh/PDF/        (behind
    audit)          jobs             worksheet)        adapters)
```

---

## 2. Monorepo layout (đề xuất)

```
/apps
  /web            Next.js (Parent web + Child web + Teacher web)
  /mobile         React Native / Expo (Parent + Child + Teacher)
/packages
  /domain         Domain types, entities, value objects (pure TS)
  /schemas        Zod schemas — boundary validation + AI I/O contracts
  /education-core Deterministic engines (mastery/gap/readiness/planning)
  /math-data      Grade4/Grade7 curriculum, skill graph, problem types (YAML/JSON)
  /api-contract   OpenAPI/tRPC types shared client↔server
  /api-client     Typed client (web+mobile share)
  /ai             Provider adapters (LLM, OCR/Vision) + orchestration
                  + pricing registry · model routing · margin model · budget engine · usage telemetry
  /design-tokens  Color/spacing/type tokens (web+mobile)
  /testing        Golden test harness + fixtures + AI/OCR benchmark harness
/services
  /api            HTTP server wiring domain + AI + persistence
  /workers        Background jobs (scan pipeline, recompute, notifications)
/docs
```

**Nguyên tắc chia sẻ (Tech Spec §12):** Web/iOS/Android chia sẻ **domain schemas, API client, validation, design tokens, business rules, state machines**. UI component implementation có thể khác nhưng **contract + state machine phải chung**.

---

## 3. Deterministic Core ↔ AI boundary (Tech Spec §6)

| Deterministic / Core (owns) | AI / LLM / Vision (assists) |
|---|---|
| Skill IDs, prerequisite DAG, curriculum mappings | OCR/vision hiểu homework/notebook/test |
| Mastery / gap / readiness state transitions | Semantic classification → candidate skills |
| Permission + child-safe projection | Parent-friendly explanations |
| Exam/date/time constraints | Question generation trong schema chặt |
| Audit / evidence history | Hint generation & reasoning feedback |
| Gap priority, prescription dose, Next Best Action | Tóm tắt, gợi ý cách giải thích |

**Luật:** LLM **không** tự sửa prerequisite graph hay mastery history. Mọi AI output phục vụ engine phải qua **JSON schema validation + confidence threshold + fallback**.

---

## 4. Core processing loop (Tech Spec §5)

```
Ingest evidence
  → AI classify/map skill + problem type   (AI, validated)
  → append evidence ledger                 (deterministic, append-only)
  → recompute mastery/confidence           (deterministic, pure)
  → diagnose gap / root prerequisite       (deterministic)
  → compute readiness                      (deterministic)
  → plan next best action                  (deterministic)
  → generate/select practice               (AI generate within schema / deterministic select)
  → assess                                 (AI parse + deterministic classify)
  → append evidence → update Twin
```

Engine core là **pure/deterministic** → dễ test bằng golden tests, tách khỏi I/O và AI.

---

## 5. Cross-cutting concerns

- **Auth (Privacy Architecture §2):** Parent (email + password/OTP). Child = **username + password created by the parent, changeable by the child** → child-safe projection only. 4-digit **PIN = quick access to assigned work**, not a login. Teacher invite/role. RBAC least-privilege + family scope on every request.
- **Projection layer:** mọi response đi qua projector theo role — child-safe là **server-side** (type + `assertChildSafe` + route gate), không hide-in-UI. Child token không bao giờ thấy analytics / mastery / gap / consent / billing.
- **Observability:** structured logs, traces, audit events cho consent, teacher update, AI-derived change, **mọi data-subject-rights op**, mọi deletion; theo dõi AI token/cost/latency.
- **Background jobs (Redis):** scan pipeline, recompute mastery, notification fan-out, **retention purge scheduling** (raw upload 30d), **deletion workflow** (drain AI jobs → xoá theo thứ tự, SLA ≤ 72h).
- **Storage lifecycle:** object storage sau interface (S3-compatible). **Mọi upload private** — signed expiring URL theo family+role, không public URL. `retention_expires_at` mặc định +30d; sau OCR→evidence thành công thì raw eligible purge.
- **AI provider registry:** mỗi provider có `ProviderCompliance` metadata (region, cross-border, `data_categories_allowed`, `training_allowed` **phải false** cho child data, DPA status). Orchestrator từ chối call vượt category cho phép.
- **AI cost & routing (Pricing Guardrails v1.0):** `resolveRoute` (Luna-first, 85–95% call ở tier rẻ) + `checkBudget` (per-plan target/hard-ceiling, graceful fallback, safety-critical bypass) trước mỗi metered call. Mọi call ghi `ai_usage_events` (pseudonymous, INSERT-only) → dashboard + traffic light. Public model prices = `ai_pricing_registry` effective-dated, không hard-code. Advanced model (Sonnet 5 vs Terra) benchmark-gated. Chi tiết: `docs/implementation/PRICING_AND_COST_GUARDRAILS.md`.
- **Config/secrets:** ngoài source control; env + secret manager. Encryption in transit + at rest.

> Chi tiết đầy đủ: `docs/implementation/PRIVACY_ARCHITECTURE.md` (17 nguyên tắc, anh duyệt P-05).

---

## 6. Deployment (MVP)

- **Modular monolith trước**, tách microservice chỉ khi có nhu cầu thực (Tech Spec §1).
- Postgres managed + Redis managed + object storage S3-compatible.
- Web: SSR/edge tùy route; Mobile: Expo (khớp pilot device Việt Nam).
- Feature-flag cho AI providers để swap không cần deploy lại client.

---

## 7. Ràng buộc kiến trúc (bất biến)

1. Không partition runtime theo grade.
2. Không nhét business logic vào UI component.
3. Không tin AI output khi chưa validate.
4. AI/OCR/Storage providers **replaceable** (adapter pattern).
5. Mọi thay đổi DB qua **migrations**.
6. Deterministic education logic phải có **unit + golden tests**.
