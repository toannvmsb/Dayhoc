import type { GeneratedItemContent, MathKernel, ProblemDNA } from '@copilot/domain';

/**
 * Deterministic kernel → content templater (doc 63 §4). Builds a
 * `GeneratedItemContent` from a MathKernel's EXACT numbers, operation graph and
 * expected answer, with a family-specific scenario template. NO reference
 * wording, NO AI. Shared by:
 *   - the mock item generator (offline test double), and
 *   - the production deterministic last-resort generator.
 *
 * `variant` rotates the scenario noun / template so the last-resort can produce
 * something distinct from what a model already tried and got rejected for
 * similarity.
 */

export const KERNEL_TEMPLATER_VERSION = 'kernel-templater.v1';

const KERNEL_NOUNS = [
  'quầy sách', 'bến phà', 'vườn ươm', 'kho thóc', 'trạm bơm', 'xưởng gỗ', 'quán phở',
  'bãi giữ xe', 'lò bánh', 'trại gà', 'hồ cá', 'sạp rau', 'nhà kính', 'bến xe', 'kho vật tư', 'ruộng ngô',
  'hiệu sách', 'tổ dân phố', 'câu lạc bộ', 'nông trại', 'phòng thí nghiệm', 'thư viện',
] as const;
const KERNEL_THINGS = [
  'thùng hàng', 'phần quà', 'quyển vở', 'chiếc bút', 'ki-lô-gam gạo', 'lít nước', 'viên gạch', 'hộp bánh',
  'bó rau', 'túi cam', 'cuộn len', 'hộp sữa',
] as const;

export function kernelOrdinal(itemId: string): number {
  const m = /item-(\d+)/.exec(itemId);
  return m ? Number(m[1]) : 1;
}

function answerString(ans: MathKernel['expectedAnswer']): string {
  switch (ans.kind) {
    case 'numeric':
      return String(ans.value);
    case 'fraction':
      return `${ans.numerator}/${ans.denominator}`;
    case 'exact':
      return ans.value;
    case 'choice':
      return ans.correct;
    default:
      return '';
  }
}

/**
 * @param dna     the problem DNA (carries `mathKernel`)
 * @param variant scenario rotation offset (0 = mock default; ≥1 = last-resort re-roll)
 */
export function buildContentFromKernel(dna: ProblemDNA, variant = 0): GeneratedItemContent {
  const k = dna.mathKernel;
  if (!k) throw new Error('buildContentFromKernel requires dna.mathKernel');
  const base = kernelOrdinal(dna.itemId);
  const n = base + variant;
  const noun = KERNEL_NOUNS[(n - 1) % KERNEL_NOUNS.length]!;
  const thing = KERNEL_THINGS[(n * 3 + variant) % KERNEL_THINGS.length]!;
  const nums = k.requiredNumbersInPrompt;
  const ans = k.expectedAnswer;
  const answerStr = answerString(ans);
  const distractors = ans.kind === 'choice' ? [...ans.distractors] : undefined;

  let prompt: string;
  switch (k.family) {
    case 'INT_ARITH':
    case 'DISTRIBUTIVE':
      prompt = `Tính${n % 2 ? '' : ' giá trị của biểu thức'}: ${k.canonicalVerificationExpression ?? nums.join(' + ')} = ?`;
      break;
    case 'ANGLE_TYPE':
      prompt = `Cho một góc có số đo ${nums[0]}°. Hỏi góc đó thuộc loại nào? Chọn đáp án đúng.`;
      break;
    case 'ANGLE_SUM':
      prompt = `Một tam giác có hai góc bằng ${nums[0]}° và ${nums[1]}°. Tính số đo góc còn lại.`;
      break;
    case 'RATIO_SHARE': {
      const ratio = nums.slice(1).join(' : ');
      const grp = nums.length > 3 ? 'ba' : 'hai';
      const N = nums[0];
      prompt = [
        `${noun.charAt(0).toUpperCase() + noun.slice(1)} chia ${N} ${thing} cho ${grp} nhóm theo tỉ lệ ${ratio}. Hỏi nhóm thứ nhất nhận được bao nhiêu ${thing}?`,
        `Người ta cần phân phối ${N} ${thing} sao cho ${grp} tổ nhận theo tỉ lệ ${ratio}. Tổ đầu tiên được bao nhiêu ${thing}?`,
        `Ba bạn góp chung ${N} ${thing} rồi chia lại theo tỉ lệ ${ratio}. Phần của bạn thứ nhất là bao nhiêu ${thing}?`,
        `Số ${thing} tổng cộng là ${N}. Nếu chia theo tỉ lệ ${ratio} thì phần đầu tiên bằng bao nhiêu?`,
        `Một sợi dây gồm ${N} đơn vị được cắt thành ${grp} đoạn theo tỉ lệ ${ratio}; đoạn thứ nhất dài bao nhiêu đơn vị?`,
        `Cho ${N} ${thing} và tỉ lệ chia ${ratio}. Tính số ${thing} ứng với thành phần thứ nhất của tỉ lệ.`,
      ][(n - 1) % 6]!;
      break;
    }
    case 'SUM_DIFF':
      prompt = `Tổng hai số là ${nums[0]}, hiệu của chúng là ${nums[1]}. Tìm số lớn.`;
      break;
    case 'UNIT_RATE':
      prompt = `Ở ${noun}, ${nums[0]} ${thing} có giá ${nums[1]} nghìn đồng. Hỏi ${nums[2]} ${thing} như thế có giá bao nhiêu nghìn đồng?`;
      break;
    case 'FRACTION_ARITH': {
      const fop = k.operationGraph[0]?.match(/[+\-×:]/)?.[0] ?? '+';
      const f1 = `${nums[0]}/${nums[1]}`;
      const f2 = `${nums[2]}/${nums[3]}`;
      // keep every framing an EXPLICIT expression — no narrative verb that could
      // contradict the kernel operation (the validator's op-keyword contract).
      prompt = [
        `Thực hiện phép tính: ${f1} ${fop} ${f2}. Viết kết quả ở dạng phân số tối giản.`,
        `Tính giá trị của biểu thức ${f1} ${fop} ${f2} rồi rút gọn.`,
        `Kết quả của phép tính ${f1} ${fop} ${f2} (viết dưới dạng phân số tối giản) là bao nhiêu?`,
        `Cho biểu thức A = ${f1} ${fop} ${f2}. Rút gọn A.`,
        `Tính rồi rút gọn: ${f1} ${fop} ${f2}.`,
        `Thực hiện: ${f1} ${fop} ${f2} = ? (phân số tối giản)`,
      ][(n - 1) % 6]!;
      break;
    }
    case 'LINEAR_EQ':
      prompt = `Tìm x, biết ${nums[0]}x + (${nums[1]}) = ${nums[2]}.`;
      break;
    case 'PERCENT':
      prompt = `Tính ${nums[0]}% của ${nums[1]}.`;
      break;
    case 'UNIT_CONVERSION':
      prompt = `Đổi ${nums[0]} ${k.operands[0]?.unit ?? ''} ra ${k.units}.`;
      break;
    case 'RECT_GEOMETRY':
      prompt = `Một hình chữ nhật có chiều dài ${nums[0]} cm và chiều rộng ${nums[1]} cm. ${k.units === 'cm²' ? 'Tính diện tích' : 'Tính chu vi'} của hình.`;
      break;
    case 'WORD_2STEP':
      prompt = `Buổi sáng ${noun} nhập ${nums[0]} ${thing}, buổi chiều nhập thêm ${nums[1]} ${thing}. Sau đó toàn bộ số ${thing} vừa nhập được nhân lên ${nums[2]} lần khi đóng gói. Hỏi cuối cùng có bao nhiêu ${thing}?`;
      break;
    default: {
      const op = /[+\-*]/.exec(k.canonicalVerificationExpression ?? '+')?.[0] ?? '+';
      const [a1, b1] = nums;
      if (op === '+') {
        prompt = [
          `${noun.charAt(0).toUpperCase() + noun.slice(1)} có ${a1} ${thing}, nhận thêm ${b1} ${thing} nữa. Hỏi ${noun} có tất cả bao nhiêu ${thing}?`,
          `Sáng nay ${noun} nhập ${a1} ${thing}; đến trưa nhập thêm ${b1} ${thing}. Tổng số ${thing} đã nhập là bao nhiêu?`,
          `Tổ Một góp ${a1} ${thing}, tổ Hai góp ${b1} ${thing}. Cả hai tổ góp bao nhiêu ${thing}?`,
        ][(n - 1) % 3]!;
      } else if (op === '-') {
        prompt = [
          `${noun.charAt(0).toUpperCase() + noun.slice(1)} có ${a1} ${thing}, đã dùng hết ${b1} ${thing}. Hỏi còn lại bao nhiêu ${thing}?`,
          `Ban đầu có ${a1} ${thing}; sau khi chuyển đi ${b1} ${thing} thì còn lại bao nhiêu ${thing}?`,
          `Trên xe có ${a1} ${thing}, xuống bến bớt ${b1} ${thing}. Trên xe còn bao nhiêu ${thing}?`,
        ][(n - 1) % 3]!;
      } else {
        prompt = [
          `Mỗi hộp có ${a1} ${thing}. Có ${b1} hộp như thế. Hỏi tất cả bao nhiêu ${thing}?`,
          `${noun.charAt(0).toUpperCase() + noun.slice(1)} đóng ${b1} thùng, mỗi thùng ${a1} ${thing}. Tổng số ${thing} là bao nhiêu?`,
          `Có ${b1} nhóm, mỗi nhóm ${a1} ${thing}. Cả ${b1} nhóm có bao nhiêu ${thing}?`,
        ][(n - 1) % 3]!;
      }
    }
  }

  return {
    itemId: dna.itemId,
    prompt,
    answer: answerStr,
    ...(distractors && distractors.length > 0 ? { distractors } : {}),
    hints: [
      'Đọc kỹ đề, ghi lại các số đã cho.',
      'Xác định phép tính / bước làm chính.',
      k.operationGraph[0] ?? 'Thực hiện phép tính.',
      'Thử với số nhỏ hơn cho dễ hình dung.',
      'Làm lại cẩn thận với số liệu của đề.',
      `Lời giải: ${k.solutionOutline}`,
    ],
    workedSolution: `${k.operationGraph.join('\n')}\nĐáp số: ${answerStr}${k.units && k.units !== '°' ? ' ' + k.units : k.units === '°' ? '°' : ''}.`,
  };
}
