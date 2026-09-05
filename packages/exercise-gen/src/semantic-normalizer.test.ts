import { describe, expect, it } from 'vitest';
import {
  multiplierPhrases,
  numberPresent,
  reconcileEquationForm,
  reconcileNumberDrop,
  reconcileOperandCollision,
  wordNumbers,
} from './semantic-normalizer.js';
import type { MathKernel } from '@copilot/domain';

/**
 * doc 62 §2/§4 — bounded Vietnamese semantic normalizer. Every equivalence has an
 * explicit test; the known false positives from the paid verification
 * (61_verification_raw.jsonl) are pinned as regression fixtures.
 */

describe('doc 62 §2 — Vietnamese number words', () => {
  it('reads một … hai mươi', () => {
    expect(wordNumbers('Hai hộp chứa cùng số que diêm')).toContain(2);
    expect(wordNumbers('chia thành ba phần')).toContain(3);
    expect(wordNumbers('mười lăm cái bánh')).toContain(15);
    expect(wordNumbers('không có số nào ở đây')).not.toContain(1);
  });

  it('does not fire on substrings ("bốn" inside another word)', () => {
    expect(wordNumbers('buôn bán')).not.toContain(4);
  });
});

describe('doc 62 §2 — multiplicative phrases', () => {
  it('gấp đôi → 2, gấp ba → 3, gấp N lần → N', () => {
    expect(multiplierPhrases('số nam gấp đôi số nữ')).toContain(2);
    expect(multiplierPhrases('gấp ba lần')).toContain(3);
    expect(multiplierPhrases('nhiều gấp 5 lần')).toContain(5);
    expect(multiplierPhrases('gấp năm lần')).toContain(5);
  });
});

describe('doc 62 §2/§4 — numberPresent (KERNEL_NUMBER_DROPPED reconciliation)', () => {
  it('digit present', () => {
    expect(numberPresent(14, 'x - 14 = 21')).toBe(true);
  });
  it('word-number coefficient — the "Hai hộp" false positive', () => {
    expect(numberPresent(2, 'Hai hộp chứa cùng số que diêm; thêm 22 que rời thì tổng là 30.')).toBe(true);
  });
  it('"gấp đôi" expresses coefficient 2', () => {
    expect(numberPresent(2, 'số học sinh nam gấp đôi số học sinh nữ')).toBe(true);
  });
  it('negative constant via "giảm N"', () => {
    expect(numberPresent(-10, 'số bút chì giảm 10 chiếc so với bình thường')).toBe(true);
  });
  it('genuinely absent → false', () => {
    expect(numberPresent(7, 'Một cửa hàng bán bánh mỗi ngày.')).toBe(false);
  });

  it('reconcileNumberDrop splits resolved vs still-missing', () => {
    const r = reconcileNumberDrop([2, 99], 'Hai hộp bút, thêm 5 cái.', '');
    expect(r.resolved).toEqual([2]);
    expect(r.stillMissing).toEqual([99]);
  });
});

function linKernel(a: number, b: number, c: number, x: number): MathKernel {
  return {
    family: 'LINEAR_EQ',
    group: 'A',
    problemTypeId: null,
    answerKind: 'numeric',
    operands: [
      { name: 'a', value: a },
      { name: 'b', value: b },
      { name: 'c', value: c },
    ],
    operationGraph: [`${a}x + (${b}) = ${c}`],
    intermediateValues: { x },
    expectedAnswer: { kind: 'numeric', value: x, tolerance: 0 },
    canonicalVerificationExpression: `( ${c} - ( ${b} ) ) : ${a}`,
    units: null,
    constraints: { integerResult: true, fractionSimplified: false },
    requiredNumbersInPrompt: [a, b, c],
    semantics: {
      operation: 'SOLVE_EQUATION',
      scenarioType: 'FIND_UNKNOWN',
      operandRoles: { a, b, c },
      askedQuantityRole: 'unknownX',
    },
    solutionOutline: '',
    kernelHash: 'test',
    builderVersion: 'test',
  } as unknown as MathKernel;
}

describe('doc 62 §2/§4 — reconcileEquationForm (SEMANTIC_STRUCTURE_MISMATCH on SOLVE_EQUATION)', () => {
  it('word problem whose solution sets up the kernel equation → PASS (the gpt-4.1-mini FP)', () => {
    const k = linKernel(7, -19, 16, 5);
    const sol =
      'Gọi x là số hộp bánh bán được trong ngày. Ta có phương trình: 7x - 19 = 16. Chuyển vế: 7x = 35. x = 5.';
    expect(reconcileEquationForm(sol, k)).toBe('PASS');
  });

  it('word problem whose solution only reaches the right x → PASS', () => {
    const k = linKernel(2, -1, 75, 38);
    expect(reconcileEquationForm('Lập phương trình rồi giải, ta được x = 38.', k)).toBe('PASS');
  });

  it('solution sets up a DIFFERENT equation → FAIL', () => {
    const k = linKernel(7, -19, 16, 5);
    expect(reconcileEquationForm('Ta có 7x + 19 = 16 nên x = -0.43.', k)).toBe('FAIL');
  });

  it('solution concludes the wrong x → FAIL', () => {
    const k = linKernel(12, -10, 38, 4);
    expect(reconcileEquationForm('Ta tính x = 2.', k)).toBe('FAIL');
  });

  it('no equation and no stated x (a made-up unrelated problem) → UNKNOWN — ANSWER_MISMATCH is the real gate', () => {
    const k = linKernel(12, -10, 38, 4);
    expect(reconcileEquationForm('12 - 10 = 2. Vậy còn 2.', k)).toBe('UNKNOWN');
  });

  it('nothing parseable → UNKNOWN (not a silent PASS)', () => {
    const k = linKernel(3, 5, 20, 5);
    expect(reconcileEquationForm('Học sinh tự trình bày lời giải.', k)).toBe('UNKNOWN');
  });
});

describe('doc 62 §2/§4 — reconcileOperandCollision (OPERAND_MUTATION)', () => {
  it('answer coincides with a structural part count → PASS (the gpt-4.1-mini "3 phần" FP)', () => {
    expect(reconcileOperandCollision(3, '18 chiếc bánh được chia thành 3 phần theo tỉ lệ 1 : 1 : 4.')).toBe('PASS');
  });
  it('answer coincides with a word-number part count → PASS', () => {
    expect(reconcileOperandCollision(3, 'chia thành ba phần bằng nhau')).toBe('PASS');
  });
  it('answer genuinely leaked with no structural explanation → FAIL', () => {
    expect(reconcileOperandCollision(42, 'Một người có 42 viên bi và một số bút.')).toBe('FAIL');
  });
});
