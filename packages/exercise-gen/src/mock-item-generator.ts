import type { GeneratedItemContent, ProblemDNA } from '@copilot/domain';
import type { ItemContentGenerator, ItemGenerationCallOutcome, ItemGenerationRequest } from './item-generator.js';
import { templateSkeleton } from './problem-dna.js';
import { buildContentFromKernel } from './kernel-templater.js';

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

function buildContent(dna: ProblemDNA): GeneratedItemContent {
  if (dna.mathKernel) return buildContentFromKernel(dna, 0);
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
