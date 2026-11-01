#!/usr/bin/env node
/**
 * Backlog B1-01 — automated quality audit of the question library (@copilot/reference-library).
 *
 * Teachers cannot read 9.400 questions, so this does the part a machine can do exactly:
 *   1. structure   — ids, hint ladder, choice answers inside their options, junk text, skill ids
 *   2. recompute   — questions whose core is plain arithmetic ("Tính 4 761 + 8 933", fractions,
 *                    decimals, "Tìm x", number sequences) are RECOMPUTED with exact rational arithmetic
 *                    and compared with the stored answer — including "Đúng/Sai" verdict items
 *   3. review sheet— a seeded random sample (default 30 per skill) as CSV for a teacher, with the
 *                    machine verdict next to each row so that human time goes to what is unverified.
 *
 *   node scripts/audit-question-library.mjs [--per-skill=30] [--seed=1] [--out=docs/implementation/data]
 *
 * Read-only on the library. Exit code 1 when a definite answer error was found.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const PER_SKILL = Number(arg('per-skill', '30'));
const SEED = Number(arg('seed', '1'));
const OUT = path.resolve(ROOT, arg('out', 'docs/implementation/data'));

const DATA = path.join(ROOT, 'packages/reference-library/src/data');
const questions = [
  ...JSON.parse(await readFile(path.join(DATA, 'questions.json'), 'utf8')),
  ...JSON.parse(await readFile(path.join(DATA, 'questions.ai-draft.json'), 'utf8')),
];
const { loadKnowledgeBase } = await import(pathToFileURL(path.join(ROOT, 'packages/math-data/dist/index.js')).href);
const kb = loadKnowledgeBase();

// ---------------------------------------------------------------- exact rationals (BigInt)
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const rat = (n, d = 1n) => { if (d === 0n) throw new Error('div0'); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d) || 1n; return { n: n / g, d: d / g }; };
const add = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
const div = (a, b) => rat(a.n * b.d, a.d * b.n);
const eq = (a, b) => a.n === b.n && a.d === b.d;

/** "12", "4 761", "2,5", "3.75" → rational */
function parseNumber(text) {
  const t = text.trim().replace(/(?<=\d) (?=\d{3}\b)/g, '').replace(',', '.');
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return null;
  const frac = m[3] ?? '';
  const n = BigInt(m[2] + frac);
  return rat(m[1] ? -n : n, 10n ** BigInt(frac.length));
}
function parseValue(text) {
  const t = String(text).trim();
  const f = /^(-?\d+)\s*\/\s*(\d+)$/.exec(t);
  if (f) return BigInt(f[2]) === 0n ? null : rat(BigInt(f[1]), BigInt(f[2]));
  return parseNumber(t);
}

/** Recursive descent over  + − × ÷ : ( ) with fraction literals a/b and thousand-spaced integers. */
function evaluate(src) {
  const toks = [];
  const re = /\s*(\d+\/\d+|\d{1,3}(?: \d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?|[()+\-×÷:*])/y;
  let i = 0;
  const s = src.trim();
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) return null;
    toks.push(m[1]);
    i = re.lastIndex;
  }
  let p = 0;
  const atom = () => {
    const t = toks[p++];
    if (t === undefined) throw new Error('eof');
    if (t === '(') { const v = sum(); if (toks[p++] !== ')') throw new Error('paren'); return v; }
    if (t === '-') return mul(atom(), rat(-1n));
    const v = parseValue(t);
    if (!v) throw new Error('num');
    return v;
  };
  const prod = () => { let v = atom(); while (['×', '*', '÷', ':'].includes(toks[p])) { const o = toks[p++]; v = o === '×' || o === '*' ? mul(v, atom()) : div(v, atom()); } return v; };
  const sum = () => { let v = prod(); while (toks[p] === '+' || toks[p] === '-') { const o = toks[p++]; v = o === '+' ? add(v, prod()) : sub(v, prod()); } return v; };
  try { const v = sum(); return p === toks.length ? v : null; } catch { return null; }
}

// ---------------------------------------------------------------- what the question *really* asks
const NUM = String.raw`\d+(?:[.,]\d+)?`;
const EXPR_CHARS = String.raw`[0-9 ()+\-×÷:*/.,]`;

/** The arithmetic core, wherever the wrapper sentence put it. null when the question is not plain arithmetic. */
function core(prompt) {
  const p = prompt.replace(/\s*\[Phiên bản \d+\]\.?/g, '');
  let m = /Tính(?: nhanh| và rút gọn)?\s*:?\s*(\(?\s*\d[0-9 ()+\-×÷:*/.,]*?)\s*(?:\.\s|\.$|\.\.|$|\?)/.exec(p);
  if (m && /\d/.test(m[1])) { const v = evaluate(m[1].replace(/\.$/, '')); if (v) return { kind: 'value', value: v, expr: m[1] }; }
  m = /Rút gọn phân số\s+(\d+)\/(\d+)/.exec(p);
  if (m && BigInt(m[2]) !== 0n) return { kind: 'value', value: rat(BigInt(m[1]), BigInt(m[2])), expr: `${m[1]}/${m[2]}` };
  m = /Tìm\s+(\d+)\/(\d+)\s+của\s+(\d+)/.exec(p);
  if (m) return { kind: 'value', value: mul(rat(BigInt(m[1]), BigInt(m[2])), rat(BigInt(m[3]))), expr: m[0] };
  m = /Điền số tiếp theo:\s*((?:\d+,\s*)+)\?/.exec(p);
  if (m) {
    const xs = m[1].split(',').map((x) => x.trim()).filter(Boolean).map(Number);
    const d = xs[1] - xs[0];
    if (xs.length >= 3 && xs.every((x, i) => i === 0 || x - xs[i - 1] === d)) return { kind: 'value', value: rat(BigInt(xs.at(-1) + d)), expr: m[0] };
  }
  m = /Tìm x:\s*(\d+)\s*[×*]\s*x\s*([+\-])\s*(\d+)\s*=\s*(\d+)/.exec(p);
  if (m) {
    const [a, b, c] = [BigInt(m[1]), BigInt(m[3]), BigInt(m[4])];
    const rhs = m[2] === '+' ? c - b : c + b;
    if (a !== 0n) return { kind: 'value', value: rat(rhs, a), expr: m[0] };
  }

  const R = (n, d = 1n) => rat(BigInt(n), BigInt(d));
  const val = (value, expr) => ({ kind: 'value', value, expr });
  const txt = (text, expr) => ({ kind: 'text', text, expr });
  const nums = (t) => t.split(/[,;]\s*/).map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
  const stripSp = (t) => t.replace(/(?<=\d) (?=\d{3}\b)/g, '');

  if ((m = /Điền số thích hợp:\s*(\d+)\/(\d+)\s*=\s*\?\/(\d+)/.exec(p))) { const v = R(m[1], m[2]); const x = mul(v, R(m[3])); if (x.d === 1n) return val(x, m[0]); }
  if ((m = /Điền số thích hợp:\s*(\d+)\s*\+\s*(\d+)\s*=\s*\2\s*\+\s*\?/.exec(p))) return val(R(m[1]), m[0]);
  if ((m = /Điền số thích hợp:\s*(\d+)\s*[×*]\s*(\d+)\s*=\s*\2\s*[×*]\s*\?/.exec(p))) return val(R(m[1]), m[0]);
  if ((m = /Tìm số trung bình cộng của\s+([\d, ]+)/.exec(p))) { const xs = nums(m[1]); if (xs.length >= 2) return val(R(xs.reduce((a, b) => a + b, 0), xs.length), m[0]); }
  if ((m = /Đổi\s+(\d+)\s+(tạ|yến|tấn|kg|m²|dm²|km²|giờ|phút|ngày)\s+ra\s+(yến|kg|tạ|dm²|cm²|m²|phút|giây|giờ)/.exec(p))) {
    const f = { 'tạ>yến': 10n, 'tấn>tạ': 10n, 'yến>kg': 10n, 'tạ>kg': 100n, 'tấn>kg': 1000n, 'm²>dm²': 100n, 'm²>cm²': 10000n, 'dm²>cm²': 100n, 'km²>m²': 1000000n, 'giờ>phút': 60n, 'phút>giây': 60n, 'ngày>giờ': 24n }[`${m[2]}>${m[3]}`];
    if (f) return val(mul(R(m[1]), rat(f)), m[0]);
  }
  if ((m = /(\d+)\s+(thế kỉ|thế kỷ)\s+bằng bao nhiêu năm/.exec(p))) return val(R(Number(m[1]) * 100), m[0]);
  if ((m = /Điền dấu > hoặc <:\s*([\d \/]+?)\s*\?\s*([\d \/]+?)\s*\./.exec(p))) {
    const a = parseValue(stripSp(m[1])), b = parseValue(stripSp(m[2]));
    if (a && b && !eq(a, b)) return txt(sub(a, b).n > 0n ? '>' : '<', m[0]);
  }
  if ((m = /Số\s+([\d ]+?)\s+là số chẵn hay số lẻ/.exec(p))) return txt(Number(stripSp(m[1])) % 2 === 0 ? 'số chẵn' : 'số lẻ', m[0]);
  if ((m = /Làm tròn số\s+([\d ]+?)\s+đến hàng (chục nghìn|trăm nghìn|chục|trăm|nghìn)/.exec(p))) {
    const unit = { chục: 10, trăm: 100, nghìn: 1000, 'chục nghìn': 10000, 'trăm nghìn': 100000 }[m[2]];
    const n = Number(stripSp(m[1])); return val(R(Math.floor((n + unit / 2) / unit) * unit), m[0]);
  }
  if ((m = /Tính giá trị biểu thức\s+(\d+)\s*[×*]\s*([a-z])\s*\+\s*(\d+)\s+khi\s+\2\s*=\s*(\d+)/.exec(p))) return val(R(Number(m[1]) * Number(m[4]) + Number(m[3])), m[0]);
  if ((m = /dài\s+(\d+)\s*cm,\s*rộng\s+(\d+)\s*cm,\s*cao\s+(\d+)\s*cm\.\s*Tính thể tích/.exec(p))) return val(R(Number(m[1]) * Number(m[2]) * Number(m[3])), m[0]);
  if ((m = /diện tích đáy\s+(\d+)\s*cm²\s+và chiều cao\s+(\d+)\s*cm\.\s*Tính thể tích/.exec(p))) return val(R(Number(m[1]) * Number(m[2])), m[0]);
  if ((m = /chia thành\s+(\d+)\s+phần bằng nhau và tô màu\s+(\d+)\s+phần/.exec(p))) return val(R(m[2], m[1]), m[0]);
  if ((m = /Viết thương\s+(\d+)\s*:\s*(\d+)\s+dưới dạng phân số tối giản/.exec(p))) return val(R(m[1], m[2]), m[0]);
  if ((m = /Góc có số đo\s+(\d+)°\s+là loại góc nào/.exec(p))) { const a = Number(m[1]); return txt(a < 90 ? 'góc nhọn' : a === 90 ? 'góc vuông' : a < 180 ? 'góc tù' : a === 180 ? 'góc bẹt' : '?', m[0]); }
  if ((m = /phân giác của góc xOy có số đo\s+(\d+)°/.exec(p))) return val(R(Number(m[1]), 2), m[0]);
  if ((m = /Tính\s+\((-?\d+)\)\^(\d+)/.exec(p))) return val(rat(BigInt(m[1]) ** BigInt(m[2])), m[0]);
  if ((m = /biểu đồ quạt tròn, một nhóm chiếm\s+(\d+)%/i.exec(p))) return val(R(Number(m[1]) * 360, 100), m[0]);
  if ((m = /y tỉ lệ thuận với x\. Khi x=(-?\d+) thì y=(-?\d+)\. Khi x=(-?\d+)/.exec(p)) && BigInt(m[1]) !== 0n) return val(mul(R(m[2], m[1]), R(m[3])), m[0]);
  if ((m = /y tỉ lệ nghịch với x\. Khi x=(-?\d+) thì y=(-?\d+)\. Khi x=(-?\d+)/.exec(p)) && BigInt(m[3]) !== 0n) return val(div(mul(R(m[1]), R(m[2])), R(m[3])), m[0]);
  if ((m = /(\d+)\s+hộp có\s+(\d+)\s+chiếc bút như nhau\. Hỏi\s+(\d+)\s+hộp/.exec(p))) return val(mul(R(m[2], m[1]), R(m[3])), m[0]);
  if ((m = /có\s+(\d+)\s+thùng hàng, nhập thêm\s+(\d+)\s+thùng\. Mỗi thùng có\s+(\d+)\s+hộp/.exec(p))) return val(R((Number(m[1]) + Number(m[2])) * Number(m[3])), m[0]);
  if ((m = /Dãy số liệu là:\s*([\d, ]+)\. Giá trị lớn nhất/.exec(p))) return val(R(Math.max(...nums(m[1]))), m[0]);
  if ((m = /Biểu đồ cột có số liệu\s+((?:[A-Z]=\d+,?\s*)+)\.\s*Cột nào cao nhất/.exec(p))) {
    const pairs = [...m[1].matchAll(/([A-Z])=(\d+)/g)].map((x) => [x[1], Number(x[2])]).sort((a, b) => b[1] - a[1]);
    if (pairs.length > 1 && pairs[0][1] !== pairs[1][1]) return txt(pairs[0][0], m[0]);
  }
  if ((m = /ghi\s+\d+\s+giá trị liên tiếp:\s*([\d, ]+)\.\s*Giá trị cuối (hơn|trừ) giá trị đầu/.exec(p))) { const xs = nums(m[1]); return { ...val(R(xs.at(-1) - xs[0]), m[0]), signed: m[2] === 'hơn' }; }
  if ((m = /(\d+)\s+kết quả thuận lợi trong\s+(\d+)\s+kết quả đồng khả năng/.exec(p))) return val(R(m[1], m[2]), m[0]);
  if ((m = /Dữ liệu phân loại gồm:\s*([A-Z, ]+)\. Có bao nhiêu phần tử thuộc nhóm\s+([A-Z])/.exec(p))) return val(R(m[1].split(',').map((x) => x.trim()).filter((x) => x === m[2]).length), m[0]);
  if ((m = /Quy đồng mẫu số hai phân số\s+(\d+)\/(\d+)\s+và\s+(\d+)\/(\d+)/.exec(p))) {
    const [a, b, c, d] = m.slice(1, 5).map(BigInt);
    const l = (b * d) / gcd(b, d);
    return txt(`${a * (l / b)}/${l} và ${c * (l / d)}/${l}`, m[0]);
  }
  return null;
}

/** "Đáp án là X" claims inside verdict items. */
function claimOf(prompt) {
  const m = /Đáp án là\s+([^”"]+?)[”"]/.exec(prompt) ?? /(?:kết quả|kết quả được ghi là|đáp án)\s+(\d[\d ]*(?:\/\d+)?)/.exec(prompt);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------- checks
const findings = []; // { id, severity: 'ERROR'|'WARN', code, detail }
const flag = (q, severity, code, detail) => findings.push({ id: q.id, skillId: q.skillId, severity, code, detail });
const verdict = new Map(); // id → 'VERIFIED' | 'UNVERIFIED' | 'FAIL'

function checkStructure(q, seen) {
  if (seen.ids.has(q.id)) flag(q, 'ERROR', 'DUP_ID', q.id); seen.ids.add(q.id);
  if (!kb.skills.has(q.skillId)) flag(q, 'ERROR', 'UNKNOWN_SKILL', q.skillId);
  if (q.hints.length !== 6 || q.hints.some((h) => !h.trim())) flag(q, 'ERROR', 'HINT_LADDER', `${q.hints.length} hints`);
  if (!q.workedSolution.trim()) flag(q, 'ERROR', 'NO_SOLUTION', '');
  if (/undefined|NaN|\[object|null\b/.test(q.prompt + q.workedSolution)) flag(q, 'ERROR', 'JUNK_TEXT', q.prompt.slice(0, 80));
  if (q.prompt.length < 8 || q.prompt.length > 700) flag(q, 'WARN', 'PROMPT_LENGTH', String(q.prompt.length));
  if (/\[Phiên bản \d+\]|\((?:Phiên bản|Mẫu|Tình huống) \d+(?:-[^)]*)?\)/.test(q.prompt)) flag(q, 'WARN', 'VERSION_TAG', 'template artefact shown to the child');
  const a = q.answerSpec;
  if (a.kind === 'choice') {
    if (new Set(a.options).size !== a.options.length) flag(q, 'ERROR', 'DUP_OPTIONS', a.options.join(' | '));
    if (!a.options.includes(a.correct)) flag(q, 'ERROR', 'CORRECT_NOT_IN_OPTIONS', `${a.correct} ∉ ${a.options.join(' | ')}`);
  }
  if (a.kind === 'fraction' && a.denominator === 0) flag(q, 'ERROR', 'ZERO_DENOMINATOR', '');
  if (a.kind === 'numeric' && !Number.isFinite(a.value)) flag(q, 'ERROR', 'NON_FINITE', '');
  const norm = q.prompt.replace(/\s+/g, ' ').trim();
  if (seen.prompts.has(norm)) flag(q, 'WARN', 'DUP_PROMPT', `same as ${seen.prompts.get(norm)}`); else seen.prompts.set(norm, q.id);
}

function storedValue(a) {
  if (a.kind === 'numeric') return parseNumber(String(a.value));
  if (a.kind === 'fraction') return a.denominator === 0 ? null : rat(BigInt(a.numerator), BigInt(a.denominator));
  if (a.kind === 'exact') return parseValue(a.value);
  if (a.kind === 'choice') return parseValue(a.correct);
  return null;
}

function recompute(q) {
  const c = core(q.prompt);
  if (!c) return 'UNVERIFIED';
  const a = q.answerSpec;
  const isVerdict = a.kind === 'choice' && a.options.length === 2 && a.options.includes('Đúng') && a.options.includes('Sai');
  if (isVerdict) {
    if (c.kind !== 'value') return 'UNVERIFIED';
    const claim = claimOf(q.prompt);
    const claimed = claim && parseValue(claim.replace(/(?<=\d) (?=\d{3}\b)/g, ''));
    if (!claimed) return 'UNVERIFIED'; // e.g. "Không đủ dữ kiện" — a deliberately wrong claim about another core
    const truth = eq(claimed, c.value) ? 'Đúng' : 'Sai';
    if (truth !== a.correct) { flag(q, 'ERROR', 'WRONG_VERDICT', `${c.expr} = ${show(c.value)}; claim ${claim}; stored "${a.correct}"`); return 'FAIL'; }
    return 'VERIFIED';
  }
  if (a.kind === 'reasoning') return 'UNVERIFIED';
  if (c.kind === 'text') {
    const got = a.kind === 'exact' ? a.value : a.kind === 'choice' ? a.correct : null;
    if (got === null) return 'UNVERIFIED';
    if (got.trim().toLowerCase() !== c.text.toLowerCase()) { flag(q, 'ERROR', 'WRONG_ANSWER', `${c.expr} → "${c.text}"; stored "${got}"`); return 'FAIL'; }
    return 'VERIFIED';
  }
  const stored = storedValue(a);
  if (!stored) return 'UNVERIFIED';
  if (a.kind === 'numeric' && a.tolerance > 0) return 'UNVERIFIED';
  if (c.signed && c.value.n < 0n) flag(q, 'WARN', 'NEGATIVE_DIFFERENCE', `${c.expr} → ${show(c.value)} (“hơn bao nhiêu” cho số âm)`);
  if (!eq(stored, c.value)) { flag(q, 'ERROR', 'WRONG_ANSWER', `${c.expr} = ${show(c.value)}; stored ${JSON.stringify(a)}`); return 'FAIL'; }
  return 'VERIFIED';
}
const show = (r) => (r.d === 1n ? `${r.n}` : `${r.n}/${r.d}`);

const seen = { ids: new Set(), prompts: new Map() };
for (const q of questions) {
  checkStructure(q, seen);
  verdict.set(q.id, recompute(q));
}

// ---------------------------------------------------------------- seeded sample for a teacher
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const rand = rng(SEED);
const bySkill = new Map();
for (const q of questions) (bySkill.get(q.skillId) ?? bySkill.set(q.skillId, []).get(q.skillId)).push(q);
const sample = [];
for (const [skill, list] of [...bySkill].sort(([a], [b]) => a.localeCompare(b))) {
  // unverified first: that is where a human adds the most
  const pool = [...list].sort(() => rand() - 0.5).sort((a, b) => Number(verdict.get(a.id) === 'VERIFIED') - Number(verdict.get(b.id) === 'VERIFIED'));
  sample.push(...pool.slice(0, PER_SKILL));
}
/** What the child actually sees (same rule as childFacingPrompt in @copilot/reference-library). */
const shown = (t) => t.replace(/\s*(?:\[Phiên bản \d+\]|\((?:Phiên bản|Mẫu|Tình huống) \d+(?:-[^)]*)?\))/g, '').replace(/\.([,.;])/g, '$1').trim();
const csvCell = (v) => `"${String(v).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
const answerText = (a) => (a.kind === 'numeric' ? a.value : a.kind === 'fraction' ? `${a.numerator}/${a.denominator}` : a.kind === 'exact' ? a.value : a.kind === 'choice' ? a.correct : '(lập luận)');
const csv = [
  ['id', 'skill', 'K', 'T', 'prompt', 'answer', 'options', 'worked_solution', 'machine_check', 'teacher_ok(Y/N)', 'teacher_note'],
  ...sample.map((q) => [q.id, q.skillId, q.knowledgeLevel, q.thinkingLevel, shown(q.prompt), answerText(q.answerSpec), q.answerSpec.kind === 'choice' ? q.answerSpec.options.join(' | ') : '', q.workedSolution, verdict.get(q.id), '', '']),
].map((r) => r.map(csvCell).join(',')).join('\r\n');

// ---------------------------------------------------------------- report
const count = (xs, f) => xs.reduce((m, x) => m.set(f(x), (m.get(f(x)) ?? 0) + 1), new Map());
const v = count(questions, (q) => verdict.get(q.id));
const byCode = count(findings, (f) => `${f.severity} ${f.code}`);
const errors = findings.filter((f) => f.severity === 'ERROR');
const kt = count(questions, (q) => `${q.knowledgeLevel}/${q.thinkingLevel}`);
const skillsWithoutK1 = [...bySkill].filter(([, l]) => !l.some((q) => q.knowledgeLevel === 'K1')).map(([s]) => s);
const pct = (n) => `${((100 * n) / questions.length).toFixed(1)}%`;
const lines = [
  '# B1-01 — kiểm tra tự động thư viện câu hỏi',
  '',
  `Sinh bởi \`scripts/audit-question-library.mjs\` (seed ${SEED}). Chỉ đọc thư viện, không sửa gì.`,
  '',
  `* Tổng số câu: **${questions.length}** · số kỹ năng: **${bySkill.size}**`,
  `* Tính lại bằng số học chính xác: **VERIFIED ${v.get('VERIFIED') ?? 0}** (${pct(v.get('VERIFIED') ?? 0)}) · **FAIL ${v.get('FAIL') ?? 0}** · chưa kiểm được ${v.get('UNVERIFIED') ?? 0} (${pct(v.get('UNVERIFIED') ?? 0)}) — cần giáo viên đọc`,
  `* Lỗi chắc chắn (ERROR): **${errors.length}**`,
  '',
  '## Phát hiện theo loại',
  '',
  ...(byCode.size ? [...byCode].sort().map(([k, n]) => `* ${k}: ${n}`) : ['* (không có)']),
  '',
  '## Phân bố K/T',
  '',
  ...[...kt].sort().map(([k, n]) => `* ${k}: ${n}`),
  '',
  `Kỹ năng chưa có câu K1: ${skillsWithoutK1.length ? skillsWithoutK1.join(', ') : '(không)'}`,
  '',
  '## Lỗi chắc chắn (tối đa 60 dòng đầu)',
  '',
  ...(errors.length ? errors.slice(0, 60).map((f) => `* \`${f.id}\` ${f.code} — ${f.detail}`) : ['* (không có)']),
  '',
  '## Cảnh báo cần giáo viên/anh quyết định',
  '',
  ...['NEGATIVE_DIFFERENCE', 'DUP_PROMPT'].flatMap((code) => {
    const xs = findings.filter((f) => f.code === code);
    return xs.length ? [`**${code}** (${xs.length}):`, ...xs.slice(0, 40).map((f) => `* \`${f.id}\` — ${f.detail}`), ''] : [];
  }),
  '`VERSION_TAG`: nhãn khuôn mẫu như “[Phiên bản N]”, “(Mẫu 1)”, “(Tình huống 1-Thấp)” nằm trong đề; đã được lọc khi nạp thư viện (`childFacingPrompt`), file dữ liệu giữ nguyên.',
  '',
  '## Lưu ý về nguồn gốc',
  '',
  'Các câu đều ghi `origin: authored`, nhưng chúng được dựng từ khuôn mẫu: cùng một lõi bài được bọc bằng nhiều câu dẫn (“Giải bài toán sau:”, “Một bạn đưa ra kết luận…”, “[Phiên bản N]”). ' +
    'Việc có đánh dấu lại thành `ai_generated`/`template` hay không do anh quyết định — báo cáo này không đổi dữ liệu.',
  '',
  `File giáo viên rà: \`B1-01_review_sample.csv\` — ${sample.length} dòng (${PER_SKILL}/kỹ năng, ưu tiên câu máy chưa kiểm được). Cột cuối để giáo viên điền Y/N.`,
  '',
];
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'B1-01_library_audit.md'), lines.join('\n'), 'utf8');
await writeFile(path.join(OUT, 'B1-01_review_sample.csv'), '\ufeff' + csv, 'utf8'); // BOM so Excel reads Vietnamese
console.log(lines.slice(0, 14).join('\n'));
console.log(`\nWrote ${path.relative(ROOT, OUT)}/B1-01_library_audit.md and B1-01_review_sample.csv`);
if (process.argv.includes('--coverage')) {
  const rows = [...bySkill].map(([s, l]) => [s, l.length, l.filter((q) => verdict.get(q.id) === 'VERIFIED').length, l.find((q) => verdict.get(q.id) === 'UNVERIFIED' && q.answerSpec.kind !== 'reasoning')]);
  for (const [s, n, ok, ex] of rows.filter(([, , ok]) => ok === 0).slice(0, 60)) console.log(s, n, ok, '|', ex?.prompt.slice(0, 130), '=>', ex && JSON.stringify(ex.answerSpec).slice(0, 50));
}
process.exit(errors.length ? 1 : 0);
