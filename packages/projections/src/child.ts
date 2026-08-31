import type { Assignment, DailyPlanResult, HintLadderState, Question } from '@copilot/domain';
import type {
  ChildChallengeView,
  ChildQuestionView,
  ChildResultView,
  ChildTask,
  ChildTodayView,
} from '@copilot/api-contract';

export interface ChildViewInput {
  readonly childDisplayName: string;
  readonly dateLabel: string;
  readonly plan: DailyPlanResult;
  readonly assignments: readonly Assignment[];
  readonly completedAssignmentIds: readonly string[];
}

const KIND_MAP: Record<Assignment['mode'], ChildTask['kind']> = {
  practice: 'practice',
  gap_repair: 'review',
  revision: 'review',
  challenge: 'challenge',
  diagnostic: 'practice',
};

const TITLE_BY_MODE: Record<Assignment['mode'], string> = {
  practice: 'Bài tập',
  gap_repair: 'Ôn tập',
  revision: 'Ôn tập',
  challenge: 'Thử thách',
  diagnostic: 'Bài kiểm tra nhỏ',
};

/**
 * CHILD-SAFE PROJECTION (UI/UX Spec §12, Math Core §31).
 *
 * Built entirely on the server from plan + assignments. The output object has
 * NO gap score, NO mastery, NO ranking, NO parent analytics — those fields are
 * absent, not hidden. A child token can only ever reach this shape.
 */
export function buildChildToday(input: ChildViewInput): ChildTodayView {
  const done = new Set(input.completedAssignmentIds);

  const tasks: ChildTask[] = input.assignments.map((a) => ({
    assignmentId: a.id,
    title: TITLE_BY_MODE[a.mode],
    subtitle: `${a.questionIds.length} ${a.mode === 'challenge' ? 'bài suy luận' : 'câu'}`,
    kind: KIND_MAP[a.mode],
    assignedBy: a.mode === 'gap_repair' ? 'parent' : 'app',
  }));

  const totalMinutes =
    input.plan.kind === 'plan'
      ? input.plan.orderedActions.reduce((s, x) => s + x.estimatedMinutes, 0)
      : 0;

  return {
    greetingName: input.childDisplayName,
    dateLabel: input.dateLabel,
    summary:
      tasks.length === 0
        ? 'Hôm nay con không có bài bắt buộc. Nghỉ ngơi nhé!'
        : `Hôm nay có ${tasks.length} việc${totalMinutes ? `, khoảng ${totalMinutes} phút` : ''}.`,
    tasks,
    doneCount: tasks.filter((t) => done.has(t.assignmentId)).length,
    totalCount: tasks.length,
  };
}

export interface ChildQuestionInput {
  readonly assignmentId: string;
  readonly question: Question;
  readonly index: number;
  readonly total: number;
  readonly hintState: HintLadderState;
}

/** One question, child-safe — only the hint rungs already unlocked are included. */
export function buildChildQuestion(input: ChildQuestionInput): ChildQuestionView {
  const { question: q, hintState } = input;
  const revealed = Math.max(0, Math.min(hintState.rungsRevealed, q.hints.length));
  return {
    assignmentId: input.assignmentId,
    questionId: q.id,
    index: input.index,
    total: input.total,
    prompt: q.prompt,
    answerKind: q.answerSpec.kind,
    ...(q.answerSpec.kind === 'choice' ? { choices: q.answerSpec.options } : {}),
    revealedHints: q.hints.slice(0, revealed).map((text, i) => ({ rung: `bậc ${i + 1}`, text })),
    canRequestHint: !hintState.resolved && hintState.rungsRevealed < q.hints.length,
  };
}

export interface ChildResultInput {
  readonly assignmentId: string;
  readonly questions: readonly Question[];
  readonly outcomes: readonly { readonly questionId: string; readonly correct: boolean }[];
  readonly hasNext: boolean;
}

export function buildChildResult(input: ChildResultInput): ChildResultView {
  const correctCount = input.outcomes.filter((o) => o.correct).length;
  const total = input.outcomes.length;
  const wrong = input.outcomes.filter((o) => !o.correct);
  const isChallenge = input.questions.some((q) => q.answerSpec.kind === 'reasoning');

  return {
    assignmentId: input.assignmentId,
    correctCount,
    total,
    headline:
      total === 0
        ? 'Con đã gửi cách nghĩ'
        : correctCount === total
          ? `Con làm đúng cả ${total} câu`
          : `Con làm đúng ${correctCount}/${total} câu`,
    encouragement:
      correctCount === total
        ? 'Rất tốt! Con nắm chắc phần này rồi.'
        : 'Cùng xem lại vài câu để lần sau chắc hơn nhé.',
    reviewItems: wrong.slice(0, 3).map((o) => {
      const q = input.questions.find((x) => x.id === o.questionId);
      return {
        questionId: o.questionId,
        prompt: q?.prompt ?? '',
        steps: q ? splitSolution(q.workedSolution) : [],
      };
    }),
    reasoningPrompt: isChallenge ? 'Con đã nghĩ theo cách nào?' : null,
    nextLabel: input.hasNext ? 'Việc tiếp theo' : 'Xong rồi',
  };
}

export function buildChildChallenge(assignmentId: string, question: Question): ChildChallengeView {
  return {
    assignmentId,
    questionId: question.id,
    badge: 'SUY LUẬN',
    prompt: question.prompt,
    instruction: 'Không cần ra đáp số ngay. Viết cách con nghĩ trước.',
    firstHintAvailable: question.hints.length > 0,
  };
}

function splitSolution(text: string): string[] {
  return text
    .split(/(?<=[.。])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Runtime guard for the API layer: assert a value carries none of the
 * parent-only keys before it is sent to a child client. Defense in depth on top
 * of the type-level guarantee.
 */
const FORBIDDEN_CHILD_KEYS = [
  'mastery',
  'gapScore',
  'score',
  'gapId',
  'severity',
  'lifecycleState',
  'ranking',
  'percentile',
  'confidence',
  'frontier',
  'rationale',
  'prescription',
];

export function assertChildSafe(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertChildSafe(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_CHILD_KEYS.includes(k)) {
        throw new Error(`child-safe projection violation: forbidden key "${k}" at ${path}`);
      }
      assertChildSafe(v, `${path}.${k}`);
    }
  }
}
