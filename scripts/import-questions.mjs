#!/usr/bin/env node
// DẠYZI — bước 2/2 của quy trình nhập câu hỏi vào ngân hàng câu hỏi.
//
// Đọc file JSON thô do scripts/questions-xlsx-to-json.py xuất ra, rồi:
//   - kiểm tra mã kỹ năng (skillId) có thật trong knowledge base không
//   - kiểm tra mã dạng bài (problemTypeId), nếu có điền, có thật không
//   - gán id dạng Q.<SKILL_ID>.<NNN> (tiếp theo số đã dùng cho kỹ năng đó)
//   - ghép vào packages/reference-library/src/data/questions.json
//   - validate file đã ghép bằng CHÍNH bộ test thật của reference-library
//     (không tự chép lại schema Zod ở đây, để không bao giờ lệch với app thật)
//
//   node scripts/import-questions.mjs <input.json> [--dry-run]
//
// --dry-run: chạy toàn bộ kiểm tra, báo sẽ thêm gì, nhưng KHÔNG ghi file.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUESTIONS_PATH = path.join(root, 'packages/reference-library/src/data/questions.json');
const AI_DRAFT_PATH = path.join(root, 'packages/reference-library/src/data/questions.ai-draft.json');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const [inputArg, ...rest] = process.argv.slice(2);
const dryRun = rest.includes('--dry-run');
if (!inputArg) fail('Cách dùng: node scripts/import-questions.mjs <input.json> [--dry-run]');

const inputPath = path.resolve(inputArg);
let raw;
try {
  raw = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (e) {
  fail(`Không đọc được ${inputPath}: ${e.message}`);
}
if (!Array.isArray(raw) || raw.length === 0) fail('File input rỗng hoặc không phải mảng câu hỏi.');

// --- knowledge base thật (dist đã build sẵn — ổn định, không phụ thuộc dev server) ---
const { loadKnowledgeBase } = await import(pathToFileURL(path.join(root, 'packages/math-data/dist/index.js')));
const kb = loadKnowledgeBase();

// --- ngân hàng câu hỏi hiện có (nguồn app thật đang đọc) ---
const existingAuthored = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf8'));
const existingDraft = JSON.parse(readFileSync(AI_DRAFT_PATH, 'utf8'));
const existingIds = new Set([...existingAuthored, ...existingDraft].map((q) => q.id));

// số thứ tự tiếp theo cho mỗi kỹ năng, tính từ id dạng Q.<SKILL>.<NNN> đã có
const nextNumForSkill = new Map();
for (const q of existingAuthored) {
  const m = /^Q\.(.+)\.(\d+)$/.exec(q.id ?? '');
  if (!m) continue;
  const [, skillId, num] = m;
  nextNumForSkill.set(skillId, Math.max(nextNumForSkill.get(skillId) ?? 0, parseInt(num, 10)));
}

const errors = [];
const toAdd = [];
const semanticOut = {};
let droppedPt = 0;
raw.forEach((q, i) => {
  const rowLabel = `Câu ${i + 1} (${q.skillId ?? '?'})`;
  if (!q.skillId || !kb.skills.has(q.skillId)) {
    errors.push(`${rowLabel}: mã kỹ năng "${q.skillId}" không tồn tại trong knowledge base thật.`);
    return;
  }
  // Mã dạng bài lạ = "archetype" của thư viện (không thuộc KB) → bỏ khỏi câu hỏi để
  // không làm nhiễu problem-type mastery của Twin; vẫn giữ lại ở file semantic.
  const { _semantic, ...clean } = q;
  if (clean.problemTypeId && !kb.problemTypes.some((pt) => pt.id === clean.problemTypeId)) {
    droppedPt += 1;
    _semantic ? (_semantic.archetype ||= clean.problemTypeId) : null;
    delete clean.problemTypeId;
  }
  const n = (nextNumForSkill.get(q.skillId) ?? 0) + 1;
  nextNumForSkill.set(q.skillId, n);
  const id = `Q.${q.skillId}.${String(n).padStart(3, '0')}`;
  if (existingIds.has(id)) {
    errors.push(`${rowLabel}: id sinh ra "${id}" bị trùng — báo lại, không nên xảy ra.`);
    return;
  }
  existingIds.add(id);
  toAdd.push({ id, ...clean });
  if (_semantic) semanticOut[id] = _semantic;
});

if (errors.length > 0) {
  console.error(`❌ ${errors.length} lỗi:\n`);
  for (const e of errors) console.error(' -', e);
  if (toAdd.length === 0) process.exit(1);
  console.error(`\n(${toAdd.length} câu hợp lệ vẫn được thử ghép bên dưới; sửa lỗi rồi chạy lại bước 1 + bước 2 để lấy đủ.)`);
}
if (toAdd.length === 0) fail('Không có câu hỏi hợp lệ nào để thêm.');

// --- ghép thử rồi validate bằng test thật của package (tránh lệch schema) ---
const merged = [...existingAuthored, ...toAdd];
const backup = readFileSync(QUESTIONS_PATH, 'utf8');
const SEMANTIC_PATH = path.join(root, 'packages/reference-library/src/data/questions.semantic.json');
let semanticBackup = null;
try { semanticBackup = readFileSync(SEMANTIC_PATH, 'utf8'); } catch {}
const semanticMerged = { ...(semanticBackup ? JSON.parse(semanticBackup) : {}), ...semanticOut };
writeFileSync(SEMANTIC_PATH, JSON.stringify(semanticMerged) + '\n', 'utf8');
writeFileSync(QUESTIONS_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf8');
const restore = () => {
  writeFileSync(QUESTIONS_PATH, backup, 'utf8');
  if (semanticBackup === null) unlinkSync(SEMANTIC_PATH);
  else writeFileSync(SEMANTIC_PATH, semanticBackup, 'utf8');
};

const test = spawnSync('npx', ['vitest', 'run', 'packages/reference-library/src/library.test.ts'], {
  cwd: root,
  shell: true,
  encoding: 'utf8',
});
if (test.status !== 0) {
  restore();
  console.error('❌ File ghép không qua được validation thật của app (đã khôi phục file gốc):\n');
  console.error(test.stdout || test.stderr);
  process.exit(1);
}

if (dryRun) {
  restore();
  console.log(`✅ Hợp lệ — sẽ thêm ${toAdd.length} câu hỏi (CHƯA ghi vì có --dry-run). Bỏ ${droppedPt} mã dạng bài không thuộc KB; ${Object.keys(semanticOut).length} câu có metadata chống lặp.`);
  console.log('  ví dụ:', toAdd.slice(0, 5).map((q) => q.id).join(', '));
  process.exit(0);
}

// build lại dist để app (Next.js) đọc được câu hỏi mới ngay khi khởi động lại
const build = spawnSync('npm', ['run', 'build', '-w', '@copilot/reference-library'], {
  cwd: root,
  shell: true,
  encoding: 'utf8',
});
if (build.status !== 0) {
  console.error('⚠ Đã ghi vào questions.json nhưng build dist thất bại — chạy lại thủ công:');
  console.error('  npm run build -w @copilot/reference-library');
  console.error(build.stdout || build.stderr);
}

console.log(`✅ Đã thêm ${toAdd.length} câu hỏi vào ngân hàng câu hỏi (+${Object.keys(semanticOut).length} metadata chống lặp).`);
