#!/usr/bin/env bash
# Device-testing API server (DẠYZI).
#
# Runs `next dev` for apps/web against the DEDICATED pilot database
# (parent_copilot_pilot — separate from parent_copilot which the test suite
# uses, so `npx vitest run` never disturbs the device-test seed).
#
# It is a supervisor: if `next dev` exits for any reason (a long-running dev
# server on this monorepo occasionally dies), it waits 2s and relaunches so a
# tester is never blocked for more than a few seconds. Ctrl-C stops it.
#
#   bash scripts/dev-pilot.sh                 # foreground
#   nohup bash scripts/dev-pilot.sh >/dev/null 2>&1 &   # background
#
# Logs (with a marker line per (re)start) go to the file below.
set -u
cd "$(dirname "$0")/.." || exit 1

# Load the repo-root .env (OPENAI_API_KEY, RESEND_API_KEY, SUPABASE_*, DZ_*,
# ...) into this process's environment so `next dev` inherits it. Next.js
# itself only auto-loads .env files from apps/web/ (its own directory), NOT
# the monorepo root — without this, every root-.env var this project's docs
# tell anh to set would silently never reach the running pilot server.
#
# NOT a plain `source .env` — bash would re-parse every value as shell
# syntax, and a value like `DạyZi <no-reply@dayzi.vn>`
# (NOTIFICATION_FROM_EMAIL) breaks that (`<...>` reads as I/O redirection).
# print-env-exports.mjs emits properly single-quoted `export KEY='value'`
# lines instead, safe to eval regardless of what a value contains.
#
# DATABASE_URL is the one var deliberately NOT taken from .env — that file's
# DATABASE_URL points at the dev/test DB (parent_copilot); this script must
# keep using its own pilot DB regardless, so a caller-supplied DATABASE_URL
# (if any) is captured BEFORE loading .env and restored after.
_caller_db_url="${DATABASE_URL:-}"
if [ -f .env ]; then
  eval "$(node scripts/print-env-exports.mjs)"
fi

export DATABASE_URL="${_caller_db_url:-postgres://postgres@127.0.0.1:5432/parent_copilot_pilot}"
export DZ_DEV_AUTH=1
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"

LOG="${DZ_DEV_LOG:-/tmp/dzapi.log}"

trap 'echo "=== [dev-pilot] stopped @ $(date -Iseconds) ===" >> "$LOG"; exit 0' INT TERM

while true; do
  echo "=== [dev-pilot] starting next dev @ $(date -Iseconds) (DB: $DATABASE_URL) ===" >> "$LOG"
  npm run dev --workspace @copilot/web >> "$LOG" 2>&1
  code=$?
  echo "=== [dev-pilot] next dev exited code=$code @ $(date -Iseconds); restarting in 2s ===" >> "$LOG"
  sleep 2
done
