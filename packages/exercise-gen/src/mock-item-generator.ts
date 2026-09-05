import type { GeneratedItemContent, ProblemDNA } from '@copilot/domain';
import type { ItemContentGenerator, ItemGenerationCallOutcome, ItemGenerationRequest } from './item-generator.js';
import { templateSkeleton } from './problem-dna.js';

/**
 * MockItemContentGenerator — deterministic, no network. Produces content that
 * satisfies the `ProblemDNA` and passes compose + `acceptItem` (including the
 * within-worksheet uniqueness / similarity gate and the deterministic answer
 * gate for `direct_computation` numeric items). Used everywhere a live model
 * would be, so the whole item pipeline is testable offline.
 *
 * Uniqueness is structural: every prompt is keyed by the item's 1-based
 * worksheet ordinal (parsed from `itemId`), which selects one of ≥16 distinct
 * scenario templates + distinct operands. A worksheet of up to 16 items is
 * therefore guaranteed collision-free.
 */

function ordinal(dna: ProblemDNA): number {
  const m = /item-(\d+)/.exec(dna.itemId);
  return m ? Number(m[1]) : 1;
}

/** operands in-range that don't reproduce any forbidden number tuple. */
function operands(dna: ProblemDNA, n: number): { a: number; b: number } {
  const forbidden = new Set(
    dna.forbiddenSimilarities.numberTuples.map((t) => [...t].sort((x, y) => x - y).join(',')),
  );
  const lo = Math.max(2, Math.floor(dna.constraints.numberRange?.min ?? 2));
  const hi = Math.max(lo + 10, Math.floor(dna.constraints.numberRange?.max ?? 40));
  for (let k = 0; k < 60; k += 1) {
    const a = lo + ((n * 7 + k * 3) % Math.max(1, hi - lo));
    const b = 2 + ((n * 5 + k * 2 + 1) % 11);
    if (!forbidden.has([a, b].sort((x, y) => x - y).join(','))) return { a, b };
  }
  return { a: lo + n, b: 2 + (n % 9) };
}

const HINTS = (sol: string): string[] => [
  'Đọc kỹ đề, xác định dữ kiện đã cho.',
  'Xác định phép tính / hướng làm chính.',
  'Thực hiện theo đúng thứ tự các bước.',
  'Thử với số nhỏ hơn để hình dung.',
  'Làm lại với số liệu của đề, cẩn thận từng bước.',
  `Lời giải: ${sol}.`,
];

interface Built {
  readonly prompt: string;
  readonly value: number;
  readonly sol: string;
}

/** 16 structurally distinct scenario templates. `s` = skill name. */
const TEMPLATES: readonly ((a: number, b: number, s: string) => Built)[] = [
  (a, b) => ({ prompt: `Tính: ${a} + ${b} = ?`, value: a + b, sol: `${a} + ${b} = ${a + b}` }),
  (a, b) => ({ prompt: `Thực hiện phép tính ${a * b} : ${b}.`, value: a, sol: `${a * b} : ${b} = ${a}` }),
  (a, b) => ({ prompt: `Một quầy sách buổi sáng bán ${a} quyển, buổi chiều bán ${b} quyển. Hỏi cả ngày quầy bán được bao nhiêu quyển?`, value: a + b, sol: `${a} + ${b} = ${a + b} (quyển)` }),
  (a, b) => ({ prompt: `Bến phà chở chuyến đầu ${a + b} khách, đến bờ có ${b} khách xuống. Trên phà còn lại bao nhiêu khách?`, value: a, sol: `${a + b} - ${b} = ${a}` }),
  (a, b) => ({ prompt: `Mỗi giờ một máy đóng gói được ${a} hộp. Sau ${b} giờ máy đóng gói được bao nhiêu hộp?`, value: a * b, sol: `${a} × ${b} = ${a * b}` }),
  (a, b) => ({ prompt: `Cô giáo chia đều ${a * b} chiếc bút cho ${b} nhóm học sinh. Mỗi nhóm nhận bao nhiêu chiếc bút?`, value: a, sol: `${a * b} : ${b} = ${a}` }),
  (a, b) => ({ prompt: `Vườn nhà bà Tư có ${a} cây cam; nhà ông Năm trồng nhiều hơn ${b} cây. Nhà ông Năm có bao nhiêu cây cam?`, value: a + b, sol: `${a} + ${b} = ${a + b}` }),
  (a, b) => ({ prompt: `Kho lạnh chứa ${a + b} thùng cá, mỗi ngày xuất ${b} thùng. Sau một ngày kho còn lại bao nhiêu thùng?`, value: a, sol: `${a + b} - ${b} = ${a}` }),
  (a, b) => ({ prompt: `Một khu phố có ${b} toà nhà, mỗi toà ${a} căn hộ. Khu phố có tất cả bao nhiêu căn hộ?`, value: a * b, sol: `${a} × ${b} = ${a * b}` }),
  (a, b) => ({ prompt: `Bác thợ cần ${a * b} viên gạch, mỗi xe chở được ${b} viên. Bác cần bao nhiêu xe để chở hết?`, value: a, sol: `${a * b} : ${b} = ${a}` }),
  (a, b) => ({ prompt: `Đội bơi thứ nhất có ${a} bạn, đội thứ hai có ${b} bạn. Cả hai đội có bao nhiêu bạn?`, value: a + b, sol: `${a} + ${b} = ${a + b}` }),
  (a, b) => ({ prompt: `Thư viện nhập ${a + b} cuốn truyện, đã cho mượn ${b} cuốn. Còn lại bao nhiêu cuốn chưa cho mượn?`, value: a, sol: `${a + b} - ${b} = ${a}` }),
  (a, b) => ({ prompt: `Trên sân có ${b} hàng ghế, mỗi hàng ${a} chiếc. Sân có tất cả bao nhiêu chiếc ghế?`, value: a * b, sol: `${a} × ${b} = ${a * b}` }),
  (a, b) => ({ prompt: `Một sợi dây dài ${a * b} cm được cắt thành các đoạn ${b} cm. Cắt được bao nhiêu đoạn?`, value: a, sol: `${a * b} : ${b} = ${a}` }),
  (a, b) => ({ prompt: `Buổi sáng cửa hàng thu ${a} nghìn đồng, buổi chiều thu thêm ${b} nghìn đồng. Cả ngày cửa hàng thu bao nhiêu nghìn đồng?`, value: a + b, sol: `${a} + ${b} = ${a + b}` }),
  (a, b) => ({ prompt: `Bể nước có ${a + b} lít, người ta dùng hết ${b} lít để tưới cây. Trong bể còn lại bao nhiêu lít nước?`, value: a, sol: `${a + b} - ${b} = ${a}` }),
  (a, b) => ({ prompt: `Quãng đường từ nhà đến trường dài ${a + b} m. Bạn Hùng đã đi được ${b} m. Bạn Hùng còn phải đi bao nhiêu mét nữa?`, value: a, sol: `${a + b} - ${b} = ${a}` }),
  (a, b) => ({ prompt: `Một tòa nhà có ${b} tầng, mỗi tầng ${a} phòng làm việc. Tòa nhà có tất cả bao nhiêu phòng làm việc?`, value: a * b, sol: `${a} × ${b} = ${a * b}` }),
  (a, b) => ({ prompt: `Bác nông dân thu hoạch được ${a * b} kg cà chua, đóng đều vào các thùng ${b} kg. Bác đóng được bao nhiêu thùng?`, value: a, sol: `${a * b} : ${b} = ${a}` }),
  (a, b) => ({ prompt: `Lớp 4A quyên góp được ${a} quyển vở, lớp 4B quyên góp nhiều hơn lớp 4A ${b} quyển. Lớp 4B quyên góp được bao nhiêu quyển vở?`, value: a + b, sol: `${a} + ${b} = ${a + b}` }),
  (a, b) => ({ prompt: `Cửa hàng nhập về ${b} két nước ngọt, mỗi két ${a} chai. Cửa hàng nhập về tất cả bao nhiêu chai nước ngọt?`, value: a * b, sol: `${a} × ${b} = ${a * b}` }),
  (a, b) => ({ prompt: `Một mảnh vườn hình chữ nhật có chu vi ${2 * (a + b)} m, chiều dài ${a} m. Chiều rộng mảnh vườn là bao nhiêu mét?`, value: b, sol: `${2 * (a + b)} : 2 - ${a} = ${b}` }),
  (a, b) => ({ prompt: `Tổ sản xuất ngày thứ nhất làm được ${a} sản phẩm, ngày thứ hai làm nhiều hơn ngày thứ nhất ${b} sản phẩm. Cả hai ngày tổ làm được bao nhiêu sản phẩm?`, value: 2 * a + b, sol: `${a} + (${a} + ${b}) = ${2 * a + b}` }),
  (a, b) => ({ prompt: `Có ${a * b} học sinh xếp thành ${b} hàng đều nhau. Mỗi hàng có bao nhiêu học sinh?`, value: a, sol: `${a * b} : ${b} = ${a}` }),
  (a, b) => ({ prompt: `Một quyển sách dày ${a + b} trang. Nam đã đọc ${b} trang. Hỏi Nam còn phải đọc bao nhiêu trang nữa thì hết quyển sách?`, value: a, sol: `${a + b} - ${b} = ${a}` }),
  (a, b) => ({ prompt: `Mỗi hộp bánh có ${a} chiếc. Cửa hàng bán ${b} hộp bánh như thế. Cửa hàng đã bán bao nhiêu chiếc bánh?`, value: a * b, sol: `${a} × ${b} = ${a * b}` }),
];

/**
 * Closed arithmetic expressions the deterministic math verifier CAN re-derive —
 * used only for `direct_computation` items (whose verification policy is
 * DETERMINISTIC_EXPECTED). Every form starts with "Tính:" so `extractExpression`
 * picks it up cleanly.
 */
const COMPUTE: readonly ((a: number, b: number) => Built)[] = [
  (a, b) => ({ prompt: `Tính: ${a} + ${b} = ?`, value: a + b, sol: `${a} + ${b} = ${a + b}` }),
  (a, b) => ({ prompt: `Tính: ${a} × ${b} = ?`, value: a * b, sol: `${a} × ${b} = ${a * b}` }),
  (a, b) => ({ prompt: `Tính: ${a + b} - ${b} = ?`, value: a, sol: `${a + b} - ${b} = ${a}` }),
  (a, b) => ({ prompt: `Tính: ${a} + ${b} + ${b} = ?`, value: a + 2 * b, sol: `${a} + ${b} + ${b} = ${a + 2 * b}` }),
  (a, b) => ({ prompt: `Tính: ( ${a} + ${b} ) - ${b} = ?`, value: a, sol: `(${a} + ${b}) - ${b} = ${a}` }),
  (a, b) => ({ prompt: `Tính: ( ${a} + ${b} ) × 2 = ?`, value: (a + b) * 2, sol: `(${a} + ${b}) × 2 = ${(a + b) * 2}` }),
  (a, b) => ({ prompt: `Tính: ${a} × ${b} + ${a} = ?`, value: a * b + a, sol: `${a} × ${b} + ${a} = ${a * b + a}` }),
  (a, b) => ({ prompt: `Tính: ${a} + ${a} + ${b} + ${b} = ?`, value: 2 * a + 2 * b, sol: `${a} + ${a} + ${b} + ${b} = ${2 * a + 2 * b}` }),
];

/** pick a template whose skeleton isn't forbidden by the DNA, starting from `start`. */
function pickTemplate(
  pool: readonly ((a: number, b: number, s: string) => Built)[],
  start: number,
  a: number,
  b: number,
  s: string,
  forbidden: ReadonlySet<string>,
): Built {
  for (let i = 0; i < pool.length; i += 1) {
    const t = pool[(start + i) % pool.length]!(a, b, s);
    if (!forbidden.has(templateSkeleton(t.prompt))) return t;
  }
  return pool[start % pool.length]!(a, b, s);
}

const KERNEL_NOUNS = [
  'quầy sách', 'bến phà', 'vườn ươm', 'kho thóc', 'trạm bơm', 'xưởng gỗ', 'quán phở',
  'bãi giữ xe', 'lò bánh', 'trại gà', 'hồ cá', 'sạp rau', 'nhà kính', 'bến xe', 'kho vật tư', 'ruộng ngô',
] as const;
const KERNEL_THINGS = ['thùng hàng', 'phần quà', 'quyển vở', 'chiếc bút', 'ki-lô-gam gạo', 'lít nước', 'viên gạch', 'hộp bánh'] as const;

/** Content that honours a MathKernel: use its numbers + its exact answer, with a varied scenario. */
function buildFromKernel(dna: ProblemDNA): GeneratedItemContent {
  const k = dna.mathKernel!;
  const n = ordinal(dna);
  const noun = KERNEL_NOUNS[(n - 1) % KERNEL_NOUNS.length]!;
  const thing = KERNEL_THINGS[(n * 3) % KERNEL_THINGS.length]!;
  const nums = k.requiredNumbersInPrompt;
  const ans = k.expectedAnswer;
  const answerStr =
    ans.kind === 'numeric'
      ? String(ans.value)
      : ans.kind === 'fraction'
        ? `${ans.numerator}/${ans.denominator}`
        : ans.kind === 'exact'
          ? ans.value
          : ans.kind === 'choice'
            ? ans.correct
            : '';
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
    case 'FRACTION_ARITH':
      prompt = `Thực hiện phép tính: ${nums[0]}/${nums[1]} ${k.operationGraph[0]?.match(/[+\-×]/)?.[0] ?? '+'} ${nums[2]}/${nums[3]}. Viết kết quả ở dạng phân số tối giản.`;
      break;
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
      // WORD_1STEP — op-aware scenario (the kernel guarantees exactly one of + - ×)
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

function buildContent(dna: ProblemDNA): GeneratedItemContent {
  if (dna.mathKernel) return buildFromKernel(dna);
  const n = ordinal(dna);
  const { a, b } = operands(dna, n);
  const skillName = dna.skill.name;
  const forbidden = new Set(dna.forbiddenSimilarities.templateSkeletons);

  if (dna.answerKind === 'reasoning') {
    const claimant = ['Nam', 'Lan', 'Bình', 'Hoa', 'Minh', 'Trang', 'Huy', 'Mai'][(n - 1) % 8]!;
    const claim = [
      `đáp số phải chia hết cho ${b}`,
      `kết quả luôn là số chẵn`,
      `giá trị không đổi khi hoán vị hai dữ kiện`,
      `đáp số luôn lớn hơn ${a}`,
      `có thể bỏ qua bước cuối vẫn ra đúng kết quả`,
      `kết quả luôn nhỏ hơn tổng hai số ban đầu`,
    ][(n - 1) % 6]!;
    const t = pickTemplate(TEMPLATES, n * 2 + 3, a, b, skillName, forbidden);
    return {
      itemId: dna.itemId,
      prompt: `${t.prompt.replace(/\?$/, '.')} Bạn ${claimant} cho rằng ${claim}. Theo em, nhận định đó luôn đúng không? Giải thích và cho ví dụ về kỹ năng "${skillName}".`,
      answer: '',
      hints: [
        'Xác định rõ nhận định cần xét.',
        'Thử một trường hợp cụ thể theo đề.',
        'Thử thêm một trường hợp khác để so sánh.',
        'Xét trường hợp đặc biệt.',
        'Tổng hợp các trường hợp đã thử.',
        'Kết luận: nhận định chỉ đúng khi thoả điều kiện; nêu điều kiện và một phản ví dụ.',
      ],
      workedSolution: `Xét kỹ năng ${skillName}: nêu một trường hợp thoả và một phản ví dụ, kết luận nhận định của bạn Nam không luôn đúng.`,
      rubric: 'Xác định đúng nhận định (0,25đ); ví dụ (0,25đ); phản ví dụ (0,25đ); kết luận rõ (0,25đ).',
    };
  }

  if (dna.problemStructure === 'direct_computation' && dna.answerKind === 'numeric') {
    // vary the operands per attempt-independent index so consecutive compute
    // items differ even when the template pool wraps
    const c = COMPUTE[(n - 1) % COMPUTE.length]!(a + (n % 3), b + ((n + 1) % 4));
    return {
      itemId: dna.itemId,
      prompt: c.prompt,
      answer: String(c.value),
      hints: HINTS(c.sol),
      workedSolution: `${c.sol}.`,
    };
  }

  const t = pickTemplate(TEMPLATES, n - 1, a, b, skillName, forbidden);

  if (dna.answerKind === 'choice') {
    return {
      itemId: dna.itemId,
      prompt: `${t.prompt} Chọn đáp án đúng.`,
      answer: String(t.value),
      distractors: [String(t.value + 1), String(t.value + b), String(Math.max(1, Math.abs(a - b)))],
      hints: HINTS(t.sol),
      workedSolution: `${t.sol}. Vậy chọn ${t.value}.`,
    };
  }
  if (dna.answerKind === 'fraction') {
    return {
      itemId: dna.itemId,
      prompt: `${t.prompt} Viết tỉ số phần lấy ra trên tổng dưới dạng phân số tối giản.`,
      answer: `${a}/${a + b}`,
      hints: HINTS(`tỉ số là ${a}/${a + b}`),
      workedSolution: `Tỉ số phần lấy ra trên tổng: ${a}/${a + b}.`,
    };
  }
  return {
    itemId: dna.itemId,
    prompt: t.prompt,
    answer: String(t.value),
    hints: HINTS(t.sol),
    workedSolution: `${t.sol}.${dna.problemStructure === 'direct_computation' ? '' : ` Đáp số: ${t.value}.`}`,
  };
}

export function createMockItemContentGenerator(opts: { name?: string } = {}): ItemContentGenerator {
  return {
    name: opts.name ?? 'mock-item-content-generator',
    provider: 'mock',
    model: 'mock',
    modelVersion: 'mock-1',
    promptVersion: null,
    generate(request: ItemGenerationRequest): Promise<ItemGenerationCallOutcome> {
      if (request.problemDNAs.length === 0) {
        return Promise.resolve({ ok: false, inability: 'no ProblemDNA supplied', latencyMs: 1 });
      }
      const dnas = request.problemDNAs.slice(0, 2);
      return Promise.resolve({ ok: true, contents: dnas.map(buildContent), latencyMs: 2 });
    },
  };
}
