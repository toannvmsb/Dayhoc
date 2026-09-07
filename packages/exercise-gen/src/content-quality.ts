import type { GeneratedExercise, MathKernel } from '@copilot/domain';

/**
 * Deterministic content-quality gate (doc 65 §9). Checks that pass the maths
 * (kernel) but a teacher would still fix: raw LaTeX the pilot UI can't render,
 * obvious unit inconsistency, an operation-language contradiction we can safely
 * detect, excessive repetition, malformed Vietnamese formatting, an empty/weak
 * hint or rubric where one is required.
 *
 * NOT an AI critic. It never rejects for merely imperfect style.
 */

export const CONTENT_QUALITY_VERSION = 'content-quality.v1';

export const CONTENT_QUALITY_CODES = [
  'RAW_LATEX',
  'UNIT_INCONSISTENT',
  'OPERATION_LANGUAGE_CONTRADICTION',
  'EXCESSIVE_REPETITION',
  'MALFORMED_VIETNAMESE',
  'WEAK_HINT_LADDER',
  'WEAK_RUBRIC',
  'EMPTY_PROMPT',
] as const;
export type ContentQualityCode = (typeof CONTENT_QUALITY_CODES)[number];

export interface ContentQualityFinding {
  readonly code: ContentQualityCode;
  readonly detail: string;
  /** BLOCK = reject + regenerate; WARN = keep, surface in the trace. */
  readonly severity: 'BLOCK' | 'WARN';
}

export interface ContentQualityResult {
  readonly ok: boolean; // no BLOCK findings
  readonly findings: readonly ContentQualityFinding[];
}

// LaTeX / TeX markup the SGK plain-text pilot UI does not render. Backslash is
// never used in Vietnamese prose, so ANY `\<letter>` command is markup; `$…$`
// math mode; and a caret/underscore bound to an alnum is a super/subscript that
// should be a real Unicode ² ³ ₁ … instead.
const LATEX_RE = /\\[a-zA-Z]+\b|\\[(){}[\]]|\$\$?[^$\n]*\$\$?|[A-Za-z0-9)]\^[A-Za-z0-9{(]|[A-Za-z]_[A-Za-z0-9{]/;

// a Vietnamese math prompt should have letters + a question; catch obvious breakage.
const VIET_LETTERS_RE = /[a-zà-ỹ]/i;
const QUESTION_CUE_RE = /\?|hỏi|tính|tìm|bao nhiêu|chọn|viết|chứng minh|giải thích|so sánh/i;

/** operation cue words that would contradict a MULTIPLICATION kernel if the ask is "each". */
const DIVISION_ASK_RE = /(mỗi|từng)\s+(hàng|nhóm|tổ|phần|người|hộp|túi|đội)\s+(có|được|nhận|chứa)\s+bao nhiêu|chia đều .* mỗi|mỗi .* là bao nhiêu/i;

export function checkContentQuality(exercise: GeneratedExercise, kernel: MathKernel | null): ContentQualityResult {
  const findings: ContentQualityFinding[] = [];
  const prompt = exercise.prompt ?? '';
  const sol = exercise.workedSolution ?? '';

  if (prompt.trim().length < 8) {
    findings.push({ code: 'EMPTY_PROMPT', detail: 'prompt is empty or too short', severity: 'BLOCK' });
  }

  if (LATEX_RE.test(prompt) || LATEX_RE.test(sol)) {
    findings.push({
      code: 'RAW_LATEX',
      detail: 'contains LaTeX markup the SGK plain-text UI cannot render (use 2/4, ×, ÷, cm²)',
      severity: 'BLOCK',
    });
  }

  if (!VIET_LETTERS_RE.test(prompt) || !QUESTION_CUE_RE.test(prompt)) {
    findings.push({
      code: 'MALFORMED_VIETNAMESE',
      detail: 'prompt is not a well-formed Vietnamese question (no letters or no ask cue)',
      severity: 'BLOCK',
    });
  }

  // unit consistency: if the kernel carries a unit, the prompt AND the solution's
  // final line should carry it (a light check — the kernel validator already does
  // a coarse one; here we look at the ANSWER line specifically).
  if (kernel?.units && kernel.units !== '°') {
    const u = kernel.units.toLowerCase();
    const answerLine = sol.split('\n').filter((l) => /đáp số|kết quả|vậy/i.test(l)).join(' ').toLowerCase();
    if (answerLine.length > 0 && !answerLine.includes(u)) {
      findings.push({
        code: 'UNIT_INCONSISTENT',
        detail: `kernel unit "${kernel.units}" missing from the answer line`,
        severity: 'WARN',
      });
    }
  }

  // operation-language contradiction — only where SAFELY detectable: a
  // MULTIPLICATION / mixed-multiply kernel whose prompt asks "how many in EACH".
  if (kernel && /MULTIPLICATION|MIXED/.test(kernel.semantics.operation) && DIVISION_ASK_RE.test(prompt)) {
    findings.push({
      code: 'OPERATION_LANGUAGE_CONTRADICTION',
      detail: 'kernel multiplies but the prompt asks a "per-group" (division) question',
      severity: 'BLOCK',
    });
  }

  // excessive repetition — a token that is not a number or stopword repeated a lot.
  const words = prompt.toLowerCase().replace(/[.,;:!?()]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !/\d/.test(w));
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] >= 5 && words.length > 0 && worst[1] / words.length > 0.25) {
    findings.push({
      code: 'EXCESSIVE_REPETITION',
      detail: `"${worst[0]}" repeated ${worst[1]}× (${Math.round((worst[1] / words.length) * 100)}% of content words)`,
      severity: 'WARN',
    });
  }

  // hint ladder — 6 non-empty rungs required.
  const hints = exercise.hints ?? [];
  if (hints.length < 6 || hints.some((h) => (h ?? '').trim().length < 3)) {
    findings.push({
      code: 'WEAK_HINT_LADDER',
      detail: `expected 6 non-empty hint rungs, got ${hints.filter((h) => (h ?? '').trim().length >= 3).length}`,
      severity: 'BLOCK',
    });
  }

  // rubric — required and non-trivial for a reasoning item.
  if (exercise.answerSpec.kind === 'reasoning') {
    const r = (exercise.rubric ?? '').trim();
    if (r.length < 15) {
      findings.push({ code: 'WEAK_RUBRIC', detail: 'reasoning item needs a substantive grading rubric', severity: 'BLOCK' });
    }
  }

  return { ok: !findings.some((f) => f.severity === 'BLOCK'), findings };
}
