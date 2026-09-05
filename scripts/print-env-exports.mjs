#!/usr/bin/env node
/**
 * Print the repo-root .env as `export KEY='value'` lines, safe to `eval` in
 * bash regardless of what characters a value contains (spaces, `<`/`>`,
 * `$`, backticks, `#`, ...). Written after discovering the hard way that
 * `source .env` directly is NOT safe for this: bash re-parses every line as
 * a shell command, so a value like `DạyZi <no-reply@dayzi.vn>`
 * (NOTIFICATION_FROM_EMAIL) gets interpreted as an I/O redirection
 * (`< no-reply@dayzi.vn`) instead of a literal string — the var ends up
 * wrong or the source call errors, either way silently (dev-pilot.sh runs
 * under `nohup ... > /dev/null 2>&1`, so a `source .env` parse error is
 * never seen).
 *
 * Usage: eval "$(node scripts/print-env-exports.mjs)"
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

let text;
try {
  text = readFileSync(envPath, 'utf8');
} catch {
  process.exit(0); // no .env — nothing to export, not an error
}

for (const rawLine of text.split('\n')) {
  const line = rawLine.trimEnd();
  if (!line || line.trimStart().startsWith('#')) continue;
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (!m) continue;
  const key = m[1];
  let value = m[2] ?? '';
  // Strip one layer of matching surrounding quotes, if present.
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1);
    }
  }
  // Single-quote for bash; escape any embedded single quotes the standard way.
  const escaped = value.replace(/'/g, `'\\''`);
  process.stdout.write(`export ${key}='${escaped}'\n`);
}
