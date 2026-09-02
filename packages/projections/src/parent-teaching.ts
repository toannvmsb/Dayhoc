import { asSkillId } from '@copilot/domain';
import type { AnswerSpec, GapType, SkillId } from '@copilot/domain';
import type {
  ParentTeachingPlanView,
  TeachingExampleView,
  TeachingStepView,
} from '@copilot/api-contract';
import { examplesForSkill } from '@copilot/reference-library';
import type { ParentViewInput } from './parent.js';

/**
 * Parent Teaching Copilot (M5).
 *
 * DạyZi coaches the PARENT: what this kind of difficulty is, a short script for
 * the adult, questions to check the child really gets it, mistakes to watch for,
 * and ONE worked example for the parent to model. It never just hands over the
 * answer. Fully deterministic — KB + reference library, no LIVE AI.
 */

interface GapScaffold {
  readonly meaning: string;
  readonly steps: readonly TeachingStepView[];
  readonly checks: readonly string[];
  readonly mistakes: readonly string[];
  readonly ifStuck: string;
}

const GENERIC_PRAISE = [
  'Khen quá trình, không chỉ kết quả: "Mẹ thích cách con thử lại khi chưa ra."',
  'Khi con giải thích được "vì sao", đó là lúc con thật sự hiểu — hãy công nhận điều đó.',
  'Nếu con làm sai, phản hồi bình tĩnh: "Gần rồi, mình xem lại bước này nhé."',
];

const GENERIC_BEFORE = [
  'Chọn lúc con không mệt, tắt TV/điện thoại, ngồi cạnh con.',
  'Chuẩn bị giấy nháp — cho con viết ra, đừng làm nhẩm hết trong đầu.',
  'Mục tiêu buổi này là con HIỂU một ý, không phải làm xong thật nhiều bài.',
];

const SCAFFOLDS: Record<GapType, GapScaffold> = {
  concept_gap: {
    meaning:
      'Con chưa nắm được ý cốt lõi của phần này — không phải con lười hay ẩu, mà là khái niệm chưa "khớp". Cần quay lại giải thích bằng ví dụ cụ thể, gần gũi.',
    steps: [
      {
        title: 'Bước 1 — Hỏi con hiểu gì trước đã',
        say: '"Con thử nói cho mẹ nghe phần này là về cái gì?"',
        why: 'Nghe con diễn đạt để biết con đang hiểu sai ở đâu, thay vì giảng lại từ đầu.',
      },
      {
        title: 'Bước 2 — Gắn với thứ con đã biết',
        say: '"Cái này giống như khi mình chia bánh / chia kẹo cho mấy bạn…"',
        why: 'Một khái niệm mới bám được khi nó nối vào trải nghiệm quen thuộc.',
      },
      {
        title: 'Bước 3 — Cùng làm 1 ví dụ thật chậm',
        say: 'Làm mẫu ví dụ bên dưới, vừa làm vừa nói to từng bước.',
        why: 'Con cần thấy tư duy diễn ra, không chỉ thấy đáp số.',
      },
      {
        title: 'Bước 4 — Đổi vai',
        say: '"Giờ con làm, mẹ nghe con giải thích từng bước nhé."',
        why: 'Con tự nói lại được thì mới là hiểu.',
      },
    ],
    checks: [
      '"Nếu đổi số khác thì con làm thế nào?"',
      '"Chỗ nào trong bài này con thấy khó hiểu nhất?"',
      '"Con giải thích cho em/bố nghe được không?"',
    ],
    mistakes: [
      'Con thuộc lòng các bước nhưng không giải thích được vì sao — đó vẫn là chưa hiểu.',
      'Con làm đúng khi có mẹ ngồi cạnh nhưng sai khi làm một mình.',
    ],
    ifStuck:
      'Nếu sau 10–15 phút con vẫn không "thông", dừng lại, khen nỗ lực, và quay lại vào hôm sau với ví dụ đơn giản hơn. Ép thêm lúc này thường phản tác dụng.',
  },
  prerequisite_gap: {
    meaning:
      'Bài hiện tại đòi hỏi một kỹ năng có từ trước mà con chưa vững. Củng cố phần nền đó trước sẽ nhanh hơn là cố "cày" bài hiện tại.',
    steps: [
      {
        title: 'Bước 1 — Nói rõ vì sao lùi lại',
        say: '"Mình quay lại phần trước một chút, xong bài này sẽ dễ hơn nhiều."',
        why: 'Con cần hiểu đây là chiến lược, không phải bị phạt.',
      },
      {
        title: 'Bước 2 — Ôn nhanh phần nền',
        say: 'Cùng con làm 2–3 bài của kỹ năng nền (xem ví dụ bên dưới).',
        why: 'Lấp lỗ hổng nền là đòn bẩy: một buổi ở đây tiết kiệm nhiều buổi phía sau.',
      },
      {
        title: 'Bước 3 — Nối lại với bài hiện tại',
        say: '"Thấy chưa, phần khó lúc nãy chính là bước này trong bài mới."',
        why: 'Giúp con thấy kiến thức là một mạch liền, không rời rạc.',
      },
    ],
    checks: [
      '"Bước nền này con làm được mấy bài liền không sai?"',
      '"Trong bài mới, chỗ nào dùng đúng kỹ năng vừa ôn?"',
    ],
    mistakes: [
      'Bỏ qua phần nền vì "con học rồi" — học rồi không có nghĩa là còn vững.',
      'Ôn nền quá lâu tới mức con nản; 10–15 phút là đủ cho một buổi.',
    ],
    ifStuck:
      'Nếu phần nền cũng lung lay nhiều, báo cho DạyZi biết (xác nhận điểm cần cải thiện) để kế hoạch luyện tập tự điều chỉnh.',
  },
  method_gap: {
    meaning:
      'Con hiểu ý nhưng chưa có cách làm gọn gàng, hay làm vòng vo hoặc bỏ bước. Cần dạy con một quy trình rõ ràng.',
    steps: [
      {
        title: 'Bước 1 — Cùng con viết ra "công thức các bước"',
        say: '"Mình liệt kê xem bài kiểu này làm theo mấy bước nhé: bước 1…, bước 2…"',
        why: 'Một quy trình viết ra giấy giúp con không bị rối giữa chừng.',
      },
      {
        title: 'Bước 2 — Làm mẫu đúng quy trình đó',
        say: 'Làm ví dụ bên dưới, chỉ tay vào từng bước trong danh sách.',
        why: 'Con thấy quy trình chạy được trên một bài thật.',
      },
      {
        title: 'Bước 3 — Con làm, mẹ nhắc tên bước (không nhắc đáp án)',
        say: '"Giờ tới bước mấy rồi con?"',
        why: 'Chuyển dần trách nhiệm điều khiển quy trình sang cho con.',
      },
    ],
    checks: [
      '"Con đọc lại các bước cho mẹ nghe mà không nhìn giấy?"',
      '"Bước nào con hay quên nhất?"',
    ],
    mistakes: [
      'Con nhảy bước để cho nhanh rồi sai ở khúc trình bày.',
      'Con làm đúng bài mẫu nhưng lúng túng khi đề đổi cách hỏi.',
    ],
    ifStuck:
      'Cho con làm 3 bài giống hệt nhau về dạng, chỉ khác số, cho tới khi quy trình thành phản xạ.',
  },
  recognition_gap: {
    meaning:
      'Con biết cách làm, nhưng không nhận ra "bài này thuộc dạng nào" nên chọn nhầm phương pháp. Cần luyện việc đọc đề và gọi tên dạng.',
    steps: [
      {
        title: 'Bước 1 — Đọc đề và hỏi "đây là dạng gì?"',
        say: '"Trước khi làm, con đoán xem bài này giống dạng nào mình từng làm?"',
        why: 'Tạo thói quen phân loại trước khi tính.',
      },
      {
        title: 'Bước 2 — Chỉ ra "từ khóa" trong đề',
        say: '"Chữ nào trong đề mách mình biết phải làm kiểu đó?"',
        why: 'Con học cách bám vào dấu hiệu của đề, không đoán mò.',
      },
      {
        title: 'Bước 3 — So sánh 2 đề gần giống nhau',
        say: 'Đưa 2 bài trông giống nhau nhưng khác dạng, hỏi con điểm khác.',
        why: 'Phân biệt được cái gần giống mới là nhận dạng thật.',
      },
    ],
    checks: [
      '"Nếu mẹ che số đi, chỉ đọc lời, con vẫn biết dạng chứ?"',
      '"Bài này khác bài hôm qua ở chỗ nào?"',
    ],
    mistakes: [
      'Con làm đúng khi bài đứng riêng, sai khi trộn nhiều dạng trong một đề luyện.',
      'Con chọn phương pháp theo bài liền trước chứ không theo đề.',
    ],
    ifStuck:
      'Làm một "bảng nhận dạng": mỗi dòng một dạng + dấu hiệu + cách làm. Con tự điền dần.',
  },
  application_gap: {
    meaning:
      'Con làm được bài "tính thuần", nhưng khi đề là bài toán có lời văn / tình huống thực tế thì con lúng túng khâu chuyển lời thành phép tính.',
    steps: [
      {
        title: 'Bước 1 — Gạch chân dữ kiện và câu hỏi',
        say: '"Đề cho mình biết gì? Đề hỏi gì? Con gạch chân giúp mẹ."',
        why: 'Tách dữ kiện khỏi câu chữ là bước khó nhất của bài lời văn.',
      },
      {
        title: 'Bước 2 — Vẽ hoặc tóm tắt',
        say: '"Mình vẽ sơ đồ / ghi tóm tắt cho dễ nhìn nhé."',
        why: 'Hình ảnh hóa giúp con thấy quan hệ giữa các số.',
      },
      {
        title: 'Bước 3 — Từ tóm tắt viết phép tính',
        say: '"Giờ nhìn tóm tắt, mình cần làm phép gì?"',
        why: 'Con nối được từ tình huống sang phép tính.',
      },
      {
        title: 'Bước 4 — Kiểm tra đáp số có hợp lý không',
        say: '"Đáp số này nghe có lý không? Ví dụ tuổi mà ra số âm là sai rồi."',
        why: 'Dạy con phản xạ soi lại kết quả trong bối cảnh thực.',
      },
    ],
    checks: [
      '"Con kể lại đề bằng lời của con?"',
      '"Vì sao con chọn phép tính này chứ không phải phép kia?"',
    ],
    mistakes: [
      'Con cộng/nhân hết các số trong đề mà không nghĩ.',
      'Con quên trả lời đúng câu hỏi của đề (tính ra cái khác).',
    ],
    ifStuck:
      'Bắt đầu từ bài lời văn rất ngắn (1–2 câu), tăng độ dài dần khi con quen.',
  },
  reasoning_gap: {
    meaning:
      'Con ra được đáp số nhưng chưa biết trình bày lập luận / chứng minh vì sao. Đây là kỹ năng tư duy, cần thời gian, đừng vội.',
    steps: [
      {
        title: 'Bước 1 — Hỏi "vì sao" sau mỗi bước',
        say: '"Bước này con làm được, nhưng vì sao được làm vậy?"',
        why: 'Tập cho con nói ra lý do, không chỉ thao tác.',
      },
      {
        title: 'Bước 2 — Mẹ làm mẫu một lập luận nói thành lời',
        say: 'Giải ví dụ bên dưới, nói rõ "vì … nên …" ở mỗi bước.',
        why: 'Con cần nghe mẫu một lập luận hoàn chỉnh.',
      },
      {
        title: 'Bước 3 — Con viết lại lập luận bằng câu đầy đủ',
        say: '"Con viết cho mẹ 2–3 câu giải thích cách con nghĩ."',
        why: 'Viết ra buộc con sắp xếp suy nghĩ mạch lạc.',
      },
    ],
    checks: [
      '"Nếu bạn con nói kết quả khác, con thuyết phục bạn thế nào?"',
      '"Chỗ nào trong lời giải là quan trọng nhất?"',
    ],
    mistakes: [
      'Con viết lại các phép tính và coi đó là "giải thích".',
      'Con bỏ qua bước "vì sao được phép làm thế".',
    ],
    ifStuck:
      'Không ép con viết chứng minh dài. Mỗi ngày một câu "vì … nên …" là tiến bộ thật.',
  },
  procedural_gap: {
    meaning:
      'Con hiểu ý và biết dạng, nhưng thao tác tính toán còn chậm hoặc hay lỗi nhỏ. Cần luyện cho thành thục.',
    steps: [
      {
        title: 'Bước 1 — Tìm đúng bước con hay sai',
        say: 'Cùng con làm chậm 1 bài, đánh dấu chỗ con vấp.',
        why: 'Luyện đúng chỗ yếu, không luyện tràn lan.',
      },
      {
        title: 'Bước 2 — Luyện riêng bước đó',
        say: 'Cho con 5–6 bài chỉ tập trung vào thao tác đó.',
        why: 'Tách nhỏ để con làm chủ từng phần.',
      },
      {
        title: 'Bước 3 — Ghép lại và bấm giờ nhẹ nhàng',
        say: '"Mình thử làm trọn bài xem mất bao lâu nhé — không sao nếu chậm."',
        why: 'Tăng dần tốc độ mà vẫn giữ chính xác.',
      },
    ],
    checks: ['"Con làm 3 bài liền không sai bước đó chưa?"'],
    mistakes: ['Con vội nên bỏ bước kiểm tra lại.', 'Sai dấu, sai khi rút gọn, chép nhầm số.'],
    ifStuck: 'Giảm số lượng bài, tăng chất lượng: 4 bài làm thật kỹ tốt hơn 12 bài làm ẩu.',
  },
  retention_gap: {
    meaning:
      'Con từng làm được phần này nhưng lâu không dùng nên quên. Cần ôn lại ngắn và nhắc lại cách nhau vài ngày.',
    steps: [
      {
        title: 'Bước 1 — Ôn nhanh, không dạy lại từ đầu',
        say: '"Con còn nhớ phần này chứ? Mình làm 2 bài cho nhớ lại nhé."',
        why: 'Chỉ cần "kích hoạt" lại trí nhớ, không cần bài giảng.',
      },
      {
        title: 'Bước 2 — Hẹn ôn lại sau 3–4 ngày',
        say: '"Cuối tuần mình làm lại 2 bài kiểu này xem còn nhớ không."',
        why: 'Ôn cách quãng giúp kiến thức ở lại lâu.',
      },
    ],
    checks: ['"Không nhìn vở, con nhắc lại cách làm được không?"'],
    mistakes: ['Ôn dồn một lần rồi bỏ — vài ngày sau lại quên.'],
    ifStuck: 'Nếu con quên gần hết thì coi như phần này chưa vững — quay lại như học mới.',
  },
  careless_error: {
    meaning:
      'Con hiểu bài — lỗi là do vội, do trình bày, không phải do hổng kiến thức. Đừng bắt con làm lại cả chủ đề; hãy sửa thói quen.',
    steps: [
      {
        title: 'Bước 1 — Cùng con soi lại bài đã sai',
        say: '"Con chỉ cho mẹ chỗ sai và nói xem vì sao lúc đó lại nhầm."',
        why: 'Con tự nhận ra "mình biết mà, chỉ do vội" — đó là điều cần củng cố.',
      },
      {
        title: 'Bước 2 — Lập "luật kiểm tra" ngắn',
        say: '"Từ nay làm xong mình đọc lại đề + xem lại dấu, đúng chưa?"',
        why: 'Một thói quen kiểm tra 20 giây loại bỏ phần lớn lỗi ẩu.',
      },
    ],
    checks: ['"Lần này con đã tự kiểm tra lại trước khi nộp chưa?"'],
    mistakes: ['Người lớn mắng "sao ẩu thế" — làm con sợ sai chứ không cẩn thận hơn.'],
    ifStuck:
      'Nếu lỗi "ẩu" lặp lại đúng một kiểu (VD luôn sai dấu trừ), đó có thể là lỗ hổng thật — báo DạyZi để xem lại.',
  },
  reading_error: {
    meaning: 'Con làm sai vì đọc đề chưa kỹ — bỏ sót dữ kiện hoặc hiểu nhầm câu hỏi.',
    steps: [
      {
        title: 'Bước 1 — Con đọc đề to, 2 lần',
        say: '"Đọc to giúp con nghe rõ đề muốn gì."',
        why: 'Đọc thầm dễ lướt; đọc to buộc chú ý từng chữ.',
      },
      {
        title: 'Bước 2 — Con nói lại đề bằng lời mình',
        say: '"Đề hỏi gì? Cho biết gì? Con kể lại cho mẹ."',
        why: 'Diễn đạt lại được nghĩa là hiểu đúng.',
      },
    ],
    checks: ['"Đề có mấy ý? Con trả lời đủ chưa?"'],
    mistakes: ['Con bắt đầu tính ngay khi chưa đọc hết đề.'],
    ifStuck: 'Cho con gạch chân câu hỏi chính bằng bút màu trước khi làm.',
  },
  presentation_error: {
    meaning: 'Con ra kết quả đúng nhưng trình bày lộn xộn, thiếu bước, nên bị trừ điểm.',
    steps: [
      {
        title: 'Bước 1 — Xem một bài mẫu trình bày đẹp',
        say: 'Cùng con nhìn ví dụ bên dưới, chú ý cách xuống dòng, ghi "Vậy…".',
        why: 'Con cần một chuẩn để noi theo.',
      },
      {
        title: 'Bước 2 — Con chép lại lời giải cho gọn gàng',
        say: '"Con viết lại bài này cho sạch, đủ bước nhé."',
        why: 'Luyện tay quen với cách trình bày chuẩn.',
      },
    ],
    checks: ['"Người khác đọc lời giải của con có hiểu không?"'],
    mistakes: ['Con nhảy thẳng tới đáp số, bỏ hết bước trung gian.'],
    ifStuck: 'Thống nhất một "khung trình bày" cố định và dùng cho mọi bài.',
  },
};

function answerText(spec: AnswerSpec | undefined): string {
  if (!spec) return '';
  switch (spec.kind) {
    case 'exact':
      return spec.value;
    case 'numeric':
      return String(spec.value);
    case 'fraction':
      return `${spec.numerator}/${spec.denominator}`;
    case 'choice':
      return spec.correct;
    default:
      return '';
  }
}

function walkthrough(workedSolution: string, hints: readonly string[]): string[] {
  const fromSolution = workedSolution
    .split(/(?<=[.;。])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromSolution.length >= 2) return fromSolution.slice(0, 6);
  // fall back to the low rungs of the hint ladder (guiding, not the answer)
  return hints.slice(0, 3).map((h) => h.trim()).filter(Boolean);
}

function exampleFor(skillId: string, rootSkillId: string): TeachingExampleView | null {
  const pool = [...examplesForSkill(skillId), ...examplesForSkill(rootSkillId)];
  if (pool.length === 0) return null;
  // easiest first — model with the gentlest example
  const K_ORDER = ['K0', 'K1', 'K2', 'K3', 'K4', 'K5'];
  const picked = [...pool].sort(
    (a, b) => K_ORDER.indexOf(a.knowledgeLevel) - K_ORDER.indexOf(b.knowledgeLevel),
  )[0]!;
  return {
    prompt: picked.prompt,
    walkthrough: walkthrough(picked.workedSolution, picked.hints),
    answer: answerText(picked.answerSpec as AnswerSpec),
  };
}

/**
 * Build the Teaching Copilot plan. With a `gapId` it targets that gap; without
 * one it targets the top-priority gap, or (no gaps) the current lesson skill.
 */
export function buildParentTeachingPlan(
  input: ParentViewInput,
  gapId?: string,
): ParentTeachingPlanView | null {
  const kb = input.knowledgeBase;
  const gap = gapId
    ? input.gaps.gaps.find((g) => g.id === gapId)
    : input.gaps.gaps[0];

  let skillId: SkillId;
  let rootSkillId: SkillId;
  let scaffold: GapScaffold;
  let focusLine: string;

  if (gap) {
    skillId = gap.targetSkillId;
    rootSkillId = gap.rootSkillId ?? gap.targetSkillId;
    scaffold = SCAFFOLDS[gap.type];
    focusLine = `Con đang vướng ở: ${kb.skills.get(rootSkillId)?.name ?? rootSkillId}`;
  } else {
    const active = input.context.activeSkillIds[0] ?? input.context.resolved.activeSkillIds[0];
    if (!active) return null;
    skillId = asSkillId(active);
    rootSkillId = skillId;
    scaffold = SCAFFOLDS.concept_gap;
    focusLine = `Hôm nay dạy con: ${kb.skills.get(skillId)?.name ?? skillId}`;
  }

  const rx = gap
    ? input.gaps.prescriptions.find((p) => p.gapId === gap.id)
    : undefined;
  const minutes = rx?.minutesPerSession ?? 15;

  return {
    forGapId: gap?.id ?? null,
    skillName: kb.skills.get(skillId)?.name ?? skillId,
    focusLine,
    gapMeaning: scaffold.meaning,
    minutes,
    beforeYouStart: GENERIC_BEFORE,
    steps: scaffold.steps,
    checkUnderstanding: scaffold.checks,
    commonMistakes: scaffold.mistakes,
    praise: GENERIC_PRAISE,
    workedExample: exampleFor(skillId, rootSkillId),
    ifStuck: scaffold.ifStuck,
  };
}
