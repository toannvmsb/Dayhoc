#!/usr/bin/env node
// Acceptance Gate 5 (question library policy v1.0): cùng skillId + templateSignature
// thì KHÔNG được có K/T khác nhau chỉ vì đổi số. Script này gom từng nhóm và gán
// MỘT cặp K/T chung: cặp xuất hiện nhiều nhất trong nhóm; nếu hoà thì lấy cặp gần
// trung vị nhất (tránh kéo cả nhóm về dễ nhất hoặc khó nhất). Idempotent.
//
//   node scripts/normalize-question-difficulty.mjs [--dry-run]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QP = path.join(root, 'packages/reference-library/src/data/questions.json');
const SP = path.join(root, 'packages/reference-library/src/data/questions.semantic.json');
const dryRun = process.argv.includes('--dry-run');

const questions = JSON.parse(readFileSync(QP, 'utf8'));
const semantic = JSON.parse(readFileSync(SP, 'utf8'));

const groups = new Map();
for (const q of questions) {
  const s = semantic[q.id];
  if (!s) continue;
  const key = `${q.skillId}|${s.templateSignature}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(q);
}

const rank = (q) => Number(q.knowledgeLevel[1]) * 10 + Number(q.thinkingLevel[1]);
const dist = () => {
  const d = {};
  for (const q of questions) {
    const k = `${q.knowledgeLevel}/${q.thinkingLevel}`;
    d[k] = (d[k] ?? 0) + 1;
  }
  return d;
};
const before = dist();

let mixedGroups = 0;
let relabeled = 0;
for (const qs of groups.values()) {
  const counts = new Map();
  for (const q of qs) {
    const k = `${q.knowledgeLevel}/${q.thinkingLevel}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size <= 1) continue;
  mixedGroups += 1;

  const sorted = [...qs].sort((a, b) => rank(a) - rank(b));
  const median = sorted[Math.floor(sorted.length / 2)];
  const medianKey = `${median.knowledgeLevel}/${median.thinkingLevel}`;
  const top = Math.max(...counts.values());
  const tied = [...counts.entries()].filter(([, n]) => n === top).map(([k]) => k);
  const target = tied.length === 1 ? tied[0] : tied.includes(medianKey) ? medianKey : tied[0];
  const [K, T] = target.split('/');
  for (const q of qs) {
    if (q.knowledgeLevel !== K || q.thinkingLevel !== T) {
      q.knowledgeLevel = K;
      q.thinkingLevel = T;
      relabeled += 1;
    }
  }
}

console.log(`Nhóm lệch K/T: ${mixedGroups}/${groups.size}; câu được gán lại nhãn: ${relabeled}/${questions.length}`);
console.log('Trước:', JSON.stringify(before));
console.log('Sau:  ', JSON.stringify(dist()));
if (!dryRun) writeFileSync(QP, JSON.stringify(questions, null, 2) + '\n', 'utf8');
else console.log('(--dry-run: chưa ghi)');
