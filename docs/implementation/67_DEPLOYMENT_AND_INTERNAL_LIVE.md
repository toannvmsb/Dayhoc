# 67 — DEPLOYMENT & INTERNAL LIVE READINESS (D1–D7)

> Real staging deployment against the Supabase project, then the Internal LIVE
> readiness gate. AI generation architecture is LOCKED (doc 66). LIVE stays OFF.
>
> **Locked:** generator default `gpt-4.1-mini` · high-complexity/frontier/fallback
> `gpt-5-mini` · Group-C verifier `gpt-4.1-mini`, geometry/proof `gpt-5-mini` ·
> no `gpt-4o-mini` in production · MathKernel + validator authoritative.

---

## PHASE D1 — REAL STAGING INFRASTRUCTURE  ⏸  STOP — one manual value needed

### Audit of what already exists

Supabase project **`yribgnhfxgvyiducukgy`** (org "EchToan"), created 2026‑09‑05.
All checks below were run from the local machine against the real project.

| capability | state | evidence |
|---|---|---|
| Supabase **Auth** | ✅ reachable | `GET /auth/v1/health` → 200; `resolveAuthAdapter(process.env)` → `kind: "supabase"` |
| Private **Storage** | ✅ ready | bucket `dayzi-evidence` exists, `public: false`; `resolveUploadStorageAdapter` → `SupabaseStorageAdapter` |
| Service secrets in `.env` (gitignored) | ✅ present | `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| Staging **PostgreSQL** schema | ❌ **empty** | every table (`users`, `evidence`, `pgmigrations`, `worksheet_generation_runs`, `ai_usage_events`, …) → PostgREST 404; **0 of 24 migrations applied** |
| Staging Postgres **connection string** | ❌ **not available** | `DATABASE_URL` in `.env` points at the local portable Postgres; the Supabase DB password is not in the environment and cannot be read from the dashboard by tooling |
| Deployed web/API host | ⚠️ none | no `Dockerfile` / `vercel.json` / `fly.toml`. **Not required for D3–D7** — migrations + the D3/D6/D7 integration tests run locally against the staging Postgres with synthetic accounts. A deployed host is a separate, later step for real browser/pilot traffic. |
| `apps/web` worksheet-generation wiring | ✅ automatic | `apps/web/lib/server/api.ts` calls `createProductionApi` without injecting `worksheetGeneration`; `production-api.ts` then auto-resolves it from env via `resolveWorksheetGeneration` — so `AI_GENERATION_MODE=SHADOW` in the staging env activates it |
| Migration ↔ Supabase compatibility | ✅ expected OK | only `pgcrypto` is `CREATE EXTENSION`d (Supabase pre-installs it); `SET session_replication_role = replica` in migration `1757635200000` + the deletion workflow is session-local and permitted for Supabase's `postgres` role |

### 🔴 STOP — the one manual action

**Everything is in place except the staging Postgres connection string.** I need
it to run the 24 migrations and to point the D3/D6/D7 tests at the real database.

1. **Open:** Supabase dashboard → project **`yribgnhfxgvyiducukgy`** → **Project
   Settings → Database → "Connection string"**.
2. **Copy:** the **Session pooler** URI (`Mode: Session`, port `5432`) — it looks
   like
   `postgresql://postgres.yribgnhfxgvyiducukgy:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`.
   Replace `[YOUR-PASSWORD]` with the database password you set when you created
   the project (Settings → Database → "Database password" → *Reset* it if you no
   longer have it — resetting is safe, nothing is using it yet).
3. **Value required:** that full URI, password included.
4. **Where to store it:** add a new line to the repo-root **`.env`** (gitignored —
   never in source):
   ```
   STAGING_DATABASE_URL=postgresql://postgres.yribgnhfxgvyiducukgy:...@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
   Keep the existing `DATABASE_URL` (local Postgres) unchanged — the D‑phase
   runners will use `STAGING_DATABASE_URL` explicitly so local dev and the local
   integration suite keep working.

Once `STAGING_DATABASE_URL` is in `.env`, I continue automatically: run the 24
migrations against staging, then D2–D7.

_(nothing else is blocked — Auth, Storage, Resend, OpenAI all verified working)_

---

## PHASE D2 — DURABLE WORKSHEET QUEUE  ⏳
## PHASE D3 — REAL POSTGRES / STORAGE / AUTH  ⏳
## PHASE D4 — REVIEWER PATH  ⏳
## PHASE D5 — GROUP-C STAGING CROSSCHECK  ⏳
## PHASE D6 — FULL PRODUCTION-PATH STAGING TEST  ⏳
## PHASE D7 — FINAL CONFIRMATION COHORT  ⏳

_(pending D1)_
