import { describe, expect, it } from 'vitest';
import { normalizeNotation } from './compose.js';

/** doc 68 §10 — deterministic LaTeX → SGK notation normalization. */
describe('normalizeNotation', () => {
  it('converts the common LaTeX forms models leak on algebra', () => {
    expect(normalizeNotation('Tính $3 \\times 4$')).toBe('Tính 3 × 4');
    expect(normalizeNotation('\\frac{2}{3} + \\frac{1}{6}')).toBe('(2)/(3) + (1)/(6)');
    expect(normalizeNotation('x \\div 2 \\leq 5')).toBe('x : 2 ≤ 5');
    expect(normalizeNotation('góc bằng 90^\\circ')).toBe('góc bằng 90°');
    expect(normalizeNotation('\\(a + b\\)')).toBe('a + b');
    expect(normalizeNotation('\\text{Đáp số: } 12')).toBe('Đáp số: 12');
  });

  it('leaves plain SGK notation untouched', () => {
    const s = 'Một hình chữ nhật có chiều dài 8 cm, chiều rộng 3 cm. Tính chu vi.';
    expect(normalizeNotation(s)).toBe(s);
    expect(normalizeNotation('2/3 + 1/6 = 5/6')).toBe('2/3 + 1/6 = 5/6');
  });

  it('is idempotent', () => {
    const once = normalizeNotation('$\\frac{a}{b} \\times c$');
    expect(normalizeNotation(once)).toBe(once);
  });
});
