import { describe, expect, it } from 'vitest';
import {
  asChildId,
  asSkillId,
  KNOWLEDGE_LEVELS,
  MATH_KERNEL_FAMILIES,
  THINKING_LEVELS,
  type GeneratedExercise,
  type ItemGenerationSpec,
  type MathKernel,
  type MathKernelFamily,
} from '@copilot/domain';
import { buildKernelOfFamily } from './math-kernel.js';
import { verifyKernelWithOracle } from './kernel-oracle.js';
import { validateAgainstKernel } from './kernel-validator.js';

/**
 * doc 58 §1/§2 — MathKernel Integrity Gate. Property / invariant testing for
 * every family with an INDEPENDENT oracle (substitution, inverse relations,
 * conservation laws). FREE — no model call. Kernel correctness must be 100%.
 */

const INSTANCES_PER_FAMILY = 240;

function probeSpec(family: MathKernelFamily, i: number): ItemGenerationSpec {
  const k = KNOWLEDGE_LEVELS[i % KNOWLEDGE_LEVELS.length]!;
  const t = THINKING_LEVELS[i % THINKING_LEVELS.length]!;
  return {
    itemId: `integrity::${family}::${i}`,
    generationSpecId: 'integrity',
    index: i,
    skillId: asSkillId('M4.ARITH.DISTRIBUTIVE'),
    targetRole: 'CURRENT',
    bucket: 'currentSkill',
    domain: 'arithmetic',
    curriculumNodeId: 'C.G4.8.5',
    curriculumOrigin: 4,
    schoolGrade: 4,
    knowledgeLevel: k,
    thinkingLevel: t,
    problemStructure: 'direct_computation',
    answerKind: family === 'ANGLE_TYPE' ? 'choice' : family === 'FRACTION_ARITH' ? 'fraction' : 'numeric',
    problemTypeId: null,
    requiredSkillIds: [asSkillId('M4.ARITH.DISTRIBUTIVE')],
    supportingSkillIds: [],
    curriculumSafety: { noUnlearnedRequiredKnowledge: true, allowAboveGradeKnowledge: false, blockingPrerequisiteSkillIds: [] },
    constraints: { language: 'vi', notation: 'SGK', hintRungs: 6, ageAppropriate: true, maxSolutionComplexity: 'standard' },
    answerVerificationPolicy: 'DETERMINISTIC_EXPECTED',
  };
}

describe('doc 58 §1/§2 — kernel families vs independent oracle', () => {
  for (const family of MATH_KERNEL_FAMILIES) {
    it(`${family}: ${INSTANCES_PER_FAMILY} deterministic instances — oracle 100%`, () => {
      const failures: string[] = [];
      let built = 0;
      for (let i = 0; i < INSTANCES_PER_FAMILY; i += 1) {
        const res = buildKernelOfFamily(family, probeSpec(family, i));
        if (!res.ok) {
          failures.push(`instance ${i}: no kernel — ${res.reason}`);
          continue;
        }
        built += 1;
        const k = res.kernel;
        // structural invariants
        if (k.family !== family) failures.push(`instance ${i}: family mismatch`);
        if (k.requiredNumbersInPrompt.length === 0) failures.push(`instance ${i}: no required numbers`);
        if (k.constraints.integerResult && k.expectedAnswer.kind === 'numeric' && !Number.isInteger(k.expectedAnswer.value)) {
          failures.push(`instance ${i}: integerResult violated (${k.expectedAnswer.value})`);
        }
        if (k.expectedAnswer.kind === 'fraction' && k.expectedAnswer.denominator === 0) {
          failures.push(`instance ${i}: zero denominator`);
        }
        // the INDEPENDENT oracle
        const oracle = verifyKernelWithOracle(k);
        if (!oracle.ok) failures.push(`instance ${i}: ORACLE ${oracle.failures.join('; ')}`);
        if (oracle.invariantsChecked.length === 0 && family !== 'ANGLE_TYPE') {
          failures.push(`instance ${i}: oracle checked NOTHING`);
        }
      }
      expect(built).toBeGreaterThan(INSTANCES_PER_FAMILY * 0.9);
      expect(failures.slice(0, 10)).toEqual([]);
    });
  }
});

describe('doc 58 §1 — boundary + robustness', () => {
  it('LINEAR_EQ never produces a zero coefficient; substitution always holds', () => {
    for (let i = 0; i < 300; i += 1) {
      const r = buildKernelOfFamily('LINEAR_EQ', probeSpec('LINEAR_EQ', i));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const a = r.kernel.semantics.operandRoles.a!;
      expect(a).not.toBe(0);
      expect(verifyKernelWithOracle(r.kernel).ok).toBe(true);
    }
  });

  it('FRACTION_ARITH results are always reduced and finite', () => {
    for (let i = 0; i < 300; i += 1) {
      const r = buildKernelOfFamily('FRACTION_ARITH', probeSpec('FRACTION_ARITH', i));
      expect(r.ok).toBe(true);
      if (!r.ok || r.kernel.expectedAnswer.kind !== 'fraction') continue;
      const { numerator, denominator } = r.kernel.expectedAnswer;
      expect(denominator).not.toBe(0);
      const g = (x: number, y: number): number => (y === 0 ? Math.abs(x) : g(y, x % y));
      expect(g(Math.abs(numerator), Math.abs(denominator))).toBe(1);
    }
  });

  it('RATIO_SHARE conserves the total; parts stay proportional', () => {
    for (let i = 0; i < 300; i += 1) {
      const r = buildKernelOfFamily('RATIO_SHARE', probeSpec('RATIO_SHARE', i));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(verifyKernelWithOracle(r.kernel).invariantsChecked).toContain('ratio_conservation');
      expect(verifyKernelWithOracle(r.kernel).ok).toBe(true);
    }
  });

  it('UNIT_CONVERSION is reversible', () => {
    for (let i = 0; i < 200; i += 1) {
      const r = buildKernelOfFamily('UNIT_CONVERSION', probeSpec('UNIT_CONVERSION', i));
      expect(r.ok && verifyKernelWithOracle(r.kernel).ok).toBe(true);
    }
  });
});

describe('doc 58 §3 — semantic preservation (the "36 / 9" → "36 plus 9" case)', () => {
  function exFrom(k: MathKernel, prompt: string, answer: number): GeneratedExercise {
    return {
      id: 'x',
      generationSpecId: 'g',
      skillId: asSkillId('M4.ARITH.DISTRIBUTIVE'),
      requiredSkillIds: [asSkillId('M4.ARITH.DISTRIBUTIVE')],
      bucket: 'currentSkill',
      knowledgeLevel: 'K2',
      thinkingLevel: 'T2',
      prompt,
      answerSpec: { kind: 'numeric', value: answer, tolerance: 0 },
      hints: ['a', 'b', 'c', 'd', 'e', 'f'],
      workedSolution: `Kết quả: ${answer}.`,
      origin: 'ai_generated',
    };
  }

  it('a DIVISION kernel realized as ADDITION prose is a SEMANTIC_STRUCTURE_MISMATCH', () => {
    // force a division INT_ARITH instance
    let div: MathKernel | null = null;
    for (let i = 0; i < 50 && !div; i += 1) {
      const r = buildKernelOfFamily('INT_ARITH', probeSpec('INT_ARITH', i));
      if (r.ok && r.kernel.semantics.operation === 'DIVISION') div = r.kernel;
    }
    expect(div).not.toBeNull();
    if (!div) return;
    const [a, b] = div.requiredNumbersInPrompt;
    // prose says "a items plus another b" — numbers present, meaning wrong
    const bad = exFrom(div, `Có ${a} phần quà, cộng thêm ${b} phần quà nữa thì được bao nhiêu?`, div.expectedAnswer.kind === 'numeric' ? div.expectedAnswer.value : 0);
    const v = validateAgainstKernel(bad, div);
    expect(v.consistent).toBe(false);
    expect(v.codes).toContain('SEMANTIC_STRUCTURE_MISMATCH');
  });

  it('a RATIO_SHARE kernel realized with proportion language passes', () => {
    // pick a 2-part instance so the test prompt lists every given number
    let k: MathKernel | null = null;
    for (let i = 0; i < 60 && !k; i += 1) {
      const r = buildKernelOfFamily('RATIO_SHARE', probeSpec('RATIO_SHARE', i));
      if (r.ok && r.kernel.requiredNumbersInPrompt.length === 3) k = r.kernel;
    }
    expect(k).not.toBeNull();
    if (!k) return;
    const [total, p1, p2] = k.requiredNumbersInPrompt;
    const ans = k.expectedAnswer.kind === 'numeric' ? k.expectedAnswer.value : 0;
    const good = exFrom(
      k,
      `Chia ${total} quyển vở cho hai nhóm theo tỉ lệ ${p1} : ${p2}. Nhóm thứ nhất nhận bao nhiêu quyển vở?`,
      ans,
    );
    const v = validateAgainstKernel({ ...good, workedSolution: `${k.operationGraph.join(' ')} Đáp số: ${ans}.` }, k);
    expect(v.detail).toContain('consistent');
    expect(v.consistent).toBe(true);
  });

  it('a multi-step solution that MENTIONS an operand before stating the right answer does NOT flag (Round 2 regression)', () => {
    // the Round 2 killer: DISTRIBUTIVE solutions list a factor ("11 × 69 …")
    // then reach the answer ("… = 759"). The old extractor grabbed "11".
    const r = buildKernelOfFamily('DISTRIBUTIVE', probeSpec('DISTRIBUTIVE', 3));
    expect(r.ok).toBe(true);
    if (!r.ok || r.kernel.expectedAnswer.kind !== 'numeric') return;
    const k = r.kernel;
    const ans = k.expectedAnswer.value;
    const [a, b] = k.requiredNumbersInPrompt;
    const ex = exFrom(k, `Tính bằng cách thuận tiện: ${a} × ${b}`, ans);
    const good = {
      ...ex,
      workedSolution: `Ta có ${a} × ${b}. Vậy tách ${b} thành các số tròn chục rồi cộng lại. Kết quả các bước: rồi được ${ans}. Đáp số: ${ans}.`,
    };
    const v = validateAgainstKernel(good, k);
    expect(v.codes).not.toContain('SOLUTION_CONTRADICTS_KERNEL');
  });

  it('a worked solution that concludes the WRONG number is a SOLUTION_CONTRADICTS_KERNEL', () => {
    const r = buildKernelOfFamily('INT_ARITH', probeSpec('INT_ARITH', 7));
    expect(r.ok).toBe(true);
    if (!r.ok || r.kernel.expectedAnswer.kind !== 'numeric') return;
    const k = r.kernel;
    const ans = k.expectedAnswer.value;
    const ex = exFrom(k, `Tính: ${k.canonicalVerificationExpression} = ?`, ans);
    const bad = { ...ex, workedSolution: `Ta có phép tính. Đáp số: ${ans + 1}.` };
    const v = validateAgainstKernel(bad, k);
    expect(v.consistent).toBe(false);
    expect(v.codes).toContain('SOLUTION_CONTRADICTS_KERNEL');
  });
});

describe('doc 59 P1 — LINEAR_EQ semantic handling by mathematical role', () => {
  function linEx(k: MathKernel, prompt: string, ans: number): GeneratedExercise {
    return {
      id: 'x', generationSpecId: 'g', skillId: asSkillId('M7.QNUM.LINEAR_EQ'),
      requiredSkillIds: [asSkillId('M7.QNUM.LINEAR_EQ')], bucket: 'currentSkill',
      knowledgeLevel: 'K2', thinkingLevel: 'T2', prompt,
      answerSpec: { kind: 'numeric', value: ans, tolerance: 0 },
      hints: ['a', 'b', 'c', 'd', 'e', 'f'],
      workedSolution: `Chuyển vế rồi chia hai vế. Đáp số: x = ${ans}.`,
      origin: 'ai_generated',
    };
  }
  const findLinear = (pred: (k: MathKernel) => boolean): MathKernel | null => {
    for (let i = 0; i < 400; i += 1) {
      const r = buildKernelOfFamily('LINEAR_EQ', probeSpec('LINEAR_EQ', i));
      if (r.ok && r.kernel.expectedAnswer.kind === 'numeric' && pred(r.kernel)) return r.kernel;
    }
    return null;
  };

  it('b < 0 rendered as subtraction ("ax - |b| = c") — no KERNEL_NUMBER_DROPPED, no SEMANTIC_STRUCTURE_MISMATCH', () => {
    const k = findLinear((kk) => kk.requiredNumbersInPrompt.some((n) => n < 0));
    expect(k).not.toBeNull();
    if (!k) return;
    const [a, b, c] = k.requiredNumbersInPrompt as [number, number, number];
    const ans = k.expectedAnswer.kind === 'numeric' ? k.expectedAnswer.value : 0;
    const v = validateAgainstKernel(linEx(k, `Tìm x, biết: ${a}x - ${Math.abs(b)} = ${c}`, ans), k);
    expect(v.codes).not.toContain('KERNEL_NUMBER_DROPPED');
    expect(v.codes).not.toContain('SEMANTIC_STRUCTURE_MISMATCH');
  });

  it('b === 0 ("ax = c") — the implicit 0 constant is not a dropped number', () => {
    const k = findLinear((kk) => kk.requiredNumbersInPrompt.includes(0));
    if (!k) return; // 0 constant is rare in the sample
    const [a, , c] = k.requiredNumbersInPrompt as [number, number, number];
    const ans = k.expectedAnswer.kind === 'numeric' ? k.expectedAnswer.value : 0;
    const v = validateAgainstKernel(linEx(k, `Tìm x: ${a}x = ${c}`, ans), k);
    expect(v.codes).not.toContain('KERNEL_NUMBER_DROPPED');
  });

  it('word-form equation ("số cần tìm … nhân … rồi trừ …") satisfies SOLVE_EQUATION', () => {
    const k = findLinear((kk) => kk.requiredNumbersInPrompt.every((n) => n > 0));
    expect(k).not.toBeNull();
    if (!k) return;
    const [a, b, c] = k.requiredNumbersInPrompt as [number, number, number];
    const ans = k.expectedAnswer.kind === 'numeric' ? k.expectedAnswer.value : 0;
    const v = validateAgainstKernel(
      linEx(k, `Tìm số cần tìm, biết rằng số đó nhân với ${a} rồi cộng ${b} thì được ${c}.`, ans),
      k,
    );
    expect(v.codes).not.toContain('SEMANTIC_STRUCTURE_MISMATCH');
  });

  it('a garbage SOLVE_EQUATION prompt (no numbers, no equation) is still rejected', () => {
    const k = findLinear(() => true);
    expect(k).not.toBeNull();
    if (!k) return;
    const ans = k.expectedAnswer.kind === 'numeric' ? k.expectedAnswer.value : 0;
    const v = validateAgainstKernel(linEx(k, `Một cửa hàng bán được một số hàng trong ngày.`, ans), k);
    expect(v.consistent).toBe(false); // via KERNEL_NUMBER_DROPPED — the given numbers are absent
  });

  it('a word problem whose worked solution sets up a DIFFERENT equation is a FAIL, not UNKNOWN', () => {
    const k = findLinear((kk) => kk.requiredNumbersInPrompt.every((n) => n > 0));
    expect(k).not.toBeNull();
    if (!k) return;
    const [a, b, c] = k.requiredNumbersInPrompt as [number, number, number];
    const wrongAns = (k.expectedAnswer.kind === 'numeric' ? k.expectedAnswer.value : 0) + 7;
    // prompt lists every given number but the solution solves a different eq → wrong x
    const ex = linEx(k, `Một cửa hàng bán ${a} hộp mỗi ngày, sau khi bớt ${b} còn ${c}. Tìm số ngày.`, wrongAns);
    const v = validateAgainstKernel(
      { ...ex, workedSolution: `Ta có ${a}x + ${b} = ${c}. Vậy x = ${wrongAns}.` },
      k,
    );
    expect(v.semanticVerdict).toBe('FAIL');
    expect(v.consistent).toBe(false);
  });

  it('reconciled findings are reported and do not block', () => {
    const k = findLinear((kk) => kk.requiredNumbersInPrompt.some((n) => n < 0));
    if (!k) return;
    const [a, b, c] = k.requiredNumbersInPrompt as [number, number, number];
    const ans = k.expectedAnswer.kind === 'numeric' ? k.expectedAnswer.value : 0;
    const v = validateAgainstKernel(linEx(k, `Tìm x, biết: ${a}x - ${Math.abs(b)} = ${c}`, ans), k);
    expect(v.semanticVerdict).toBe('PASS');
    expect(v.consistent).toBe(true);
  });
});
