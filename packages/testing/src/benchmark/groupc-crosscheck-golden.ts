import type { GeneratedExercise } from '@copilot/domain';
import { asSkillId } from '@copilot/domain';

/**
 * doc 66 §6 — Group-C answer-crosscheck golden benchmark. ~20 synthetic
 * reasoning / find-the-error / construct-an-example items, each with a
 * Claude-drafted GOLDEN verdict:
 *   PASS      — the worked solution's maths is sound and reaches a correct result
 *   FAIL      — the worked solution contains a wrong step / wrong conclusion
 *   UNCERTAIN — genuinely open / underspecified (a good verifier should hedge)
 *
 * The HARD requirement is false PASS = 0: a verifier must NEVER say PASS on a
 * FAIL item.
 */

export type GoldenVerdict = 'PASS' | 'FAIL' | 'UNCERTAIN';

export interface GroupCGoldenCase {
  readonly id: string;
  readonly golden: GoldenVerdict;
  readonly note: string;
  /** school grade the verifier should assume (default 4). */
  readonly grade?: 4 | 7;
  readonly exercise: GeneratedExercise;
}

function ex(over: Partial<GeneratedExercise>): GeneratedExercise {
  return {
    id: over.id ?? 'x',
    generationSpecId: 'gc-golden',
    skillId: asSkillId('M4.ALG.DIST'),
    requiredSkillIds: [asSkillId('M4.ALG.DIST')],
    bucket: 'thinkingChallenge',
    knowledgeLevel: 'K2',
    thinkingLevel: 'T4',
    prompt: '',
    answerSpec: { kind: 'reasoning' },
    hints: ['a', 'b', 'c', 'd', 'e', 'f'],
    workedSolution: '',
    rubric: 'Nêu đúng bước lập luận 0,5đ; kết quả đúng 0,5đ.',
    origin: 'ai_generated',
    ...over,
  };
}

export const GROUPC_GOLDEN: readonly GroupCGoldenCase[] = [
  {
    id: 'gc01', golden: 'PASS', note: 'distributive proof, both sides = 217',
    exercise: ex({ id: 'gc01', prompt: 'Chứng minh 7 × (12 + 19) = 7 × 12 + 7 × 19.', workedSolution: 'Vế trái: 7 × 31 = 217. Vế phải: 84 + 133 = 217. Hai vế bằng nhau nên đẳng thức đúng.' }),
  },
  {
    id: 'gc02', golden: 'FAIL', note: 'right side computed wrong: 84 + 133 ≠ 227',
    exercise: ex({ id: 'gc02', prompt: 'Chứng minh 7 × (12 + 19) = 7 × 12 + 7 × 19.', workedSolution: 'Vế trái: 7 × 31 = 217. Vế phải: 7 × 12 + 7 × 19 = 84 + 133 = 227. Vậy hai vế không bằng nhau.' }),
  },
  {
    id: 'gc03', golden: 'PASS', note: 'find-the-error: correctly identifies missing ×6 and fixes to 954',
    exercise: ex({ id: 'gc03', prompt: 'Bạn Phúc viết: 18 × (47 + 6) = 18 × 47 + 6 = 846 + 6 = 852. Hãy tìm chỗ sai và sửa lại.', workedSolution: 'Sai ở chỗ chỉ nhân 18 với 47 mà quên nhân 18 với 6. Phải là 18 × 47 + 18 × 6 = 846 + 108 = 954. Kết quả đúng là 954.' }),
  },
  {
    id: 'gc04', golden: 'FAIL', note: 'find-the-error: identifies the error but the "fix" 846 + 108 = 944 is wrong',
    exercise: ex({ id: 'gc04', prompt: 'Bạn Phúc viết: 18 × (47 + 6) = 18 × 47 + 6 = 846 + 6 = 852. Hãy tìm chỗ sai và sửa lại.', workedSolution: 'Sai vì quên nhân 18 với 6. Sửa: 18 × 47 + 18 × 6 = 846 + 108 = 944.' }),
  },
  {
    id: 'gc05', golden: 'FAIL', note: 'construct-an-example: claims 12 and 8 are coprime (gcd = 4)',
    exercise: ex({ id: 'gc05', prompt: 'Hãy nêu một ví dụ hai số tự nhiên nguyên tố cùng nhau và giải thích.', workedSolution: 'Chọn 12 và 8. Chúng nguyên tố cùng nhau vì cả hai đều chia hết cho 2 khác nhau. Vậy 12 và 8 nguyên tố cùng nhau.' }),
  },
  {
    id: 'gc06', golden: 'PASS', note: 'construct-an-example: 9 and 14, gcd = 1, sound',
    exercise: ex({ id: 'gc06', prompt: 'Hãy nêu một ví dụ hai số tự nhiên nguyên tố cùng nhau và giải thích.', workedSolution: 'Chọn 9 và 14. Ước của 9 là 1, 3, 9; ước của 14 là 1, 2, 7, 14. Ước chung lớn nhất là 1, nên 9 và 14 nguyên tố cùng nhau.' }),
  },
  {
    id: 'gc07', golden: 'FAIL', note: 'ratio reasoning: 60 shared 2:3 → parts 20 and 30 stated, but 20 + 30 = 50 ≠ 60',
    exercise: ex({ id: 'gc07', prompt: 'Chia 60 quyển vở cho hai lớp theo tỉ lệ 2 : 3. Giải thích cách chia và nêu số vở mỗi lớp.', workedSolution: 'Tổng số phần là 2 + 3 = 5. Mỗi phần là 60 : 5 = 12. Lớp thứ nhất: 2 × 12 = 20. Lớp thứ hai: 3 × 12 = 30.' }),
  },
  {
    id: 'gc08', golden: 'PASS', note: 'ratio reasoning: 60 shared 2:3 → 24 and 36, sound',
    exercise: ex({ id: 'gc08', prompt: 'Chia 60 quyển vở cho hai lớp theo tỉ lệ 2 : 3. Giải thích cách chia và nêu số vở mỗi lớp.', workedSolution: 'Tổng số phần: 2 + 3 = 5. Một phần: 60 : 5 = 12. Lớp một: 2 × 12 = 24. Lớp hai: 3 × 12 = 36. Kiểm tra: 24 + 36 = 60.' }),
  },
  {
    id: 'gc09', golden: 'FAIL', note: 'explain: claims a + 0 changes a; false',
    exercise: ex({ id: 'gc09', prompt: 'Giải thích vì sao cộng một số với 0 thì được chính số đó.', workedSolution: 'Khi cộng a với 0 ta được a + 1 vì 0 luôn thêm một đơn vị. Ví dụ 5 + 0 = 6.' }),
  },
  {
    id: 'gc10', golden: 'PASS', note: 'explain: identity of addition, sound with example',
    exercise: ex({ id: 'gc10', prompt: 'Giải thích vì sao cộng một số với 0 thì được chính số đó.', workedSolution: 'Số 0 nghĩa là "không có gì". Thêm "không có gì" vào a thì a không đổi, nên a + 0 = a. Ví dụ: 5 + 0 = 5.' }),
  },
  {
    id: 'gc11', golden: 'UNCERTAIN', note: 'open construct — many valid answers, solution is a stub with no numbers',
    exercise: ex({ id: 'gc11', prompt: 'Hãy tự đặt một bài toán có lời văn dùng phép nhân rồi giải.', workedSolution: 'Học sinh tự đặt đề và trình bày lời giải phù hợp.' }),
  },
  {
    id: 'gc12', golden: 'UNCERTAIN', note: 'genuinely ambiguous prompt — "số lớn" undefined',
    exercise: ex({ id: 'gc12', prompt: 'Cho hai số. Hãy giải thích số nào lớn hơn.', workedSolution: 'Số bên trái lớn hơn vì nó được viết trước.' }),
  },
  {
    id: 'gc13', golden: 'PASS', note: 'compare-and-decide: 3/4 vs 5/8 → 6/8 > 5/8, sound',
    exercise: ex({ id: 'gc13', prompt: 'So sánh 3/4 và 5/8, giải thích.', workedSolution: 'Quy đồng: 3/4 = 6/8. Vì 6/8 > 5/8 nên 3/4 > 5/8.' }),
  },
  {
    id: 'gc14', golden: 'FAIL', note: 'compare-and-decide: wrong common denominator, wrong conclusion',
    exercise: ex({ id: 'gc14', prompt: 'So sánh 3/4 và 5/8, giải thích.', workedSolution: 'Quy đồng: 3/4 = 3/8. Vì 3/8 < 5/8 nên 3/4 < 5/8.' }),
  },
  {
    id: 'gc15', golden: 'PASS', note: 'two-step reasoning, arithmetic all correct',
    exercise: ex({ id: 'gc15', prompt: 'Một cửa hàng buổi sáng bán 45 kg gạo, buổi chiều bán gấp đôi buổi sáng. Giải thích và tính tổng số gạo bán trong ngày.', workedSolution: 'Buổi chiều: 45 × 2 = 90 kg. Cả ngày: 45 + 90 = 135 kg.' }),
  },
  {
    id: 'gc16', golden: 'FAIL', note: 'two-step: "gấp đôi" misread as +2',
    exercise: ex({ id: 'gc16', prompt: 'Một cửa hàng buổi sáng bán 45 kg gạo, buổi chiều bán gấp đôi buổi sáng. Giải thích và tính tổng số gạo bán trong ngày.', workedSolution: 'Gấp đôi nghĩa là thêm 2, nên buổi chiều bán 45 + 2 = 47 kg. Cả ngày: 45 + 47 = 92 kg.' }),
  },
  {
    id: 'gc17', golden: 'FAIL', note: 'find-the-error: says the original is already correct when it is not',
    exercise: ex({ id: 'gc17', prompt: 'Bạn Lan viết: 25 × (8 + 4) = 25 × 8 + 4 = 200 + 4 = 204. Hãy tìm chỗ sai và sửa lại.', workedSolution: 'Bạn Lan làm đúng rồi. 25 × (8 + 4) = 25 × 12 = 204. Không có chỗ nào sai.' }),
  },
  {
    id: 'gc18', golden: 'PASS', grade: 7, note: 'angle reasoning: co-interior angles sum to 180, x = 50, sound',
    exercise: ex({ id: 'gc18', skillId: asSkillId('M7.GEO.PARALLEL_CRITERIA'), requiredSkillIds: [asSkillId('M7.GEO.PARALLEL_CRITERIA')], knowledgeLevel: 'K2', thinkingLevel: 'T3', prompt: 'Hai đường thẳng a // b bị cắt bởi c, tạo hai góc trong cùng phía 110° và (2x − 30)°. Tìm x và giải thích.', workedSolution: 'Hai góc trong cùng phía bù nhau nên 110 + (2x − 30) = 180. Suy ra 2x + 80 = 180, 2x = 100, x = 50.' }),
  },
  {
    id: 'gc19', golden: 'FAIL', grade: 7, note: 'parallel criterion: equal co-interior (not alternate) angles wrongly used to conclude parallel',
    exercise: ex({ id: 'gc19', skillId: asSkillId('M7.GEO.PARALLEL_CRITERIA'), requiredSkillIds: [asSkillId('M7.GEO.PARALLEL_CRITERIA')], knowledgeLevel: 'K2', thinkingLevel: 'T3', prompt: 'Đường thẳng c cắt a và b tạo hai góc trong cùng phía đều bằng 70°. Hỏi a có song song với b không? Giải thích.', workedSolution: 'Hai góc trong cùng phía bằng nhau (70° = 70°) nên a // b.' }),
  },
  {
    id: 'gc20', golden: 'UNCERTAIN', grade: 7, note: 'construct-an-example with a figure the verifier cannot see',
    exercise: ex({ id: 'gc20', skillId: asSkillId('M7.GEO.ANGLE_PAIRS'), requiredSkillIds: [asSkillId('M7.GEO.ANGLE_PAIRS')], knowledgeLevel: 'K2', thinkingLevel: 'T3', prompt: 'Dựa vào hình vẽ đã cho, hãy nêu một cặp góc đối đỉnh và giải thích.', workedSolution: 'Theo hình, góc AOB và góc COD là hai góc đối đỉnh nên chúng bằng nhau.' }),
  },
];
