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

export DATABASE_URL="${DATABASE_URL:-postgres://postgres@127.0.0.1:5432/parent_copilot_pilot}"
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
