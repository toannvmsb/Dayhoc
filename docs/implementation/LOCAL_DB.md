# Local Dev Database (portable Postgres)

Phase 0 uses a **portable PostgreSQL 16.4** installed in user space — no admin, no Windows
service, no password (trust auth on localhost only).

| Item | Value |
|---|---|
| Binaries | `C:\Users\AD\pg-portable\pgsql\bin` |
| Data dir | `C:\Users\AD\pg-portable\data` |
| Server log | `C:\Users\AD\pg-portable\server.log` |
| Port | `5432` |
| Superuser | `postgres` (no password, trust @ localhost) |
| Database | `parent_copilot` |
| `DATABASE_URL` | `postgres://postgres@127.0.0.1:5432/parent_copilot` (in `.env`, gitignored) |

> The server is **not** a Windows service — it does not auto-start after reboot. Start it manually.

## Start / stop / status (PowerShell)

```powershell
$bin = 'C:\Users\AD\pg-portable\pgsql\bin'; $data = 'C:\Users\AD\pg-portable\data'
& "$bin\pg_ctl.exe" -D $data -l 'C:\Users\AD\pg-portable\server.log' -o "-p 5432" start
& "$bin\pg_ctl.exe" -D $data status
& "$bin\pg_ctl.exe" -D $data stop
```

## Run migrations

```bash
# DATABASE_URL is read from the environment (see .env)
npm run db:migrate         # up
npm run db:migrate:down    # down one step
```

## psql shell

```bash
"C:\Users\AD\pg-portable\pgsql\bin\psql.exe" -d "postgres://postgres@127.0.0.1:5432/parent_copilot"
```

## Notes
- To move to a managed/Docker Postgres later, only `DATABASE_URL` changes — nothing in code.
- `pg_ctl start` can appear to hang in a non-interactive shell; it still starts. Verify with
  `pg_isready -h 127.0.0.1 -p 5432` or `pg_ctl status` in a separate call.
