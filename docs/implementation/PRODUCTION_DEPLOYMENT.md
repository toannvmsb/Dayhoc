# DạyZi — production / staging deployment

The DạyZi backend is the **Next.js app** (`apps/web`). It serves:

- the parent/student/teacher **web UI** (server actions), and
- the **mobile HTTP API** at `/api/v1` (same `createProductionApi` graph, same
  authorization; bearer header instead of cookie).

One deploy = web + API. The mobile app is a client of `/api/v1`.

---

## 1. Environment variables

`getApi()` calls `assertProductionConfig()` on first use — **the process
refuses to serve** if a production deploy is misconfigured.

| Var | Required (prod) | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `DATABASE_URL` | ✅ | Postgres **direct connection** string. On Supabase use the `postgres` role (has `BYPASSRLS`) — NOT the pooler's `authenticated` role. Include `?sslmode=require`. |
| `SUPABASE_URL` | ✅ | `https://<ref>.supabase.co` |
| `SUPABASE_JWT_SECRET` | ✅ | Project → Settings → API → JWT Secret. Used to verify the bearer (HS256). |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ if uploads use Supabase Storage | admin key — **server only**, never in any client bundle |
| `SUPABASE_STORAGE_BUCKET` | ✅ if uploads use Supabase Storage | e.g. `dayzi-evidence` — a **private** bucket |
| `DZ_UPLOAD_DIR` | — | local-fs upload path when NOT using Supabase Storage (self-host) |
| `DZ_DEV_AUTH` | **must be unset** | `assertProductionConfig()` throws if it is `1` in production |
| `DZ_LIVE_VISION` | — | leave unset. `1` + `OPENAI_API_KEY` enables paid document vision (opt-in) |
| `OPENAI_API_KEY` | — | only for opt-in live vision / Luna generation (both OFF for pilot) |

Auth adapter resolution (`resolveAuthAdapter`):
`SUPABASE_URL` + `SUPABASE_JWT_SECRET` → **Supabase** · `DZ_DEV_AUTH=1` &&
non-prod → dev · else in-memory. In production `getApi()` additionally throws if
the resolved adapter is not `supabase`.

---

## 2. Supabase setup

### Auth
1. Auth → Providers → **Email** (password). Disable sign-ups you don't want.
2. Auth → URL Configuration:
   - Site URL: `https://app.dayzi.vn`
   - Redirect URLs: `https://app.dayzi.vn/*`, and the mobile deep link
     `dayzi://` (Expo scheme in `app.config.ts`).
3. Copy **JWT Secret** → `SUPABASE_JWT_SECRET`.
4. The app verifies tokens itself (HS256). It does NOT use the anon key.
   `SUPABASE_SERVICE_ROLE_KEY` is used only for `createUser` (register) and
   Storage.

### Postgres
1. Run migrations against the direct connection:
   `DATABASE_URL=... npx node-pg-migrate up` (19 migrations, all additive).
2. RLS: migration `1758153600000` enables deny-all RLS on personal/child
   tables. The app's `postgres` role has `BYPASSRLS` so this is transparent.
   See `RLS_DECISION.md`.
3. Do NOT expose the DB via PostgREST to clients (no client DB access — §RLS).

### Storage
1. Create a **private** bucket (name → `SUPABASE_STORAGE_BUCKET`).
2. No public policy. Objects are written/read by the server with the service
   role. Keys are `child/<childId>/<uuid>-<filename>` — no PII in the key.
3. Retention: uploads are pruned after 30 days (privacy architecture) — wire a
   scheduled job / storage lifecycle rule.

---

## 3. HTTP / infra

| Concern | Setting |
|---|---|
| TLS | HTTPS only. HTTP → 301. |
| CORS | `/api/v1` is called by the native app (no browser CORS) and, for Expo web, from the app origin. Add the deployed web origin to `allowedDevOrigins` / a CORS allow-list; do not use `*` with credentials. |
| Body size | API caps request bodies at **16 MB** (413 beyond). Set the same at the proxy. |
| Timeouts | proxy read timeout ≥ 30s (vision/analysis on large uploads). API aborts its own fetches at 20s. |
| Rate limits | in-process token bucket per client+route-class (`rate-limit.ts`). For >1 instance, replace the `Map` store with Redis. |
| Health | `GET /api/v1/health` (liveness, no deps) · `GET /api/v1/ready` (503 if DB down) |
| Logs | one structured line per API request: `reqId, method, route (ids masked), status, ms, rule, err`. **No** child name / question / answer / gap / evidence / token. |
| Errors | 5xx → generic Vietnamese line, never a stack trace. 4xx → the domain message (already user-safe). |

---

## 4. Build channels

| Channel | Web | Mobile (`DZ_ENV`) | API URL |
|---|---|---|---|
| dev | `npm run dev` | `dev` + `EXPO_PUBLIC_DEV_HOST=<LAN IP>` | `http://<LAN>:3100/api/v1` |
| staging | deploy `apps/web` w/ staging DB/Supabase | `staging` | `https://staging.dayzi.vn/api/v1` |
| production | deploy `apps/web` w/ prod DB/Supabase | `production` | `https://app.dayzi.vn/api/v1` |

`app.config.ts` throws at build time if a **production** mobile build resolves a
non-HTTPS or LAN API URL. Staging/dev builds show a banner.

---

## 5. Pre-deploy checklist

- [ ] `NODE_ENV=production`, `DZ_DEV_AUTH` unset
- [ ] `DATABASE_URL` = direct connection, `sslmode=require`, `postgres` role
- [ ] `SUPABASE_URL` + `SUPABASE_JWT_SECRET` set; a test bearer verifies
- [ ] `npx node-pg-migrate up` clean (19/19)
- [ ] `GET /api/v1/ready` → `{"status":"ready"}`
- [ ] register + login via `/api/v1/auth/*` on the deployed URL
- [ ] private Storage bucket; `SUPABASE_SERVICE_ROLE_KEY` server-only
- [ ] no secret in any committed file (`git grep` clean) or client bundle
- [ ] proxy: HTTPS, 16MB body, ≥30s timeout
- [ ] mobile build: `DZ_ENV=production`, `apiIsSecure` true
