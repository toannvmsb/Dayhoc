import type { Assignment, DailyPlanResult } from '@copilot/domain';
import type { ChildTask, ChildTodayView } from '@copilot/api-contract';

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
