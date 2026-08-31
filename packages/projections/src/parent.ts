import type {
  ChildLearningTwin,
  DailyPlanResult,
  LearningContext,
} from '@copilot/domain';
import type { GapEngineResult } from '@copilot/gap-engine';
import type { KnowledgeBase } from '@copilot/math-data';
import type {
  AttentionItem,
  ParentGapDetailView,
  ParentHomeView,
  ParentPrescriptionView,
  ParentProgressView,
  SkillProgressRow,
} from '@copilot/api-contract';
import {
  activeSkillHeadline,
  childSummary,
  masteryTargetFor,
  statusWord,
  todayPlanView,
  type ChildProfileInput,
} from './shared.js';

const URGENCY: Record<'high' | 'medium' | 'low', AttentionItem['urgency']> = {
  high: 'cao',
  medium: 'trung_bình',
  low: 'thấp',
};
const PRIORITY: Record<'high' | 'medium' | 'low', ParentGapDetailView['priorityLabel']> = {
  high: 'ưu_tiên_cao',
  medium: 'ưu_tiên_trung_bình',
  low: 'ưu_tiên_thấp',
};
const LIFECYCLE_LABEL: Record<string, string> = {
  DETECTED: 'Mới phát hiện',
  CONFIRMED: 'Đã xác nhận',
  TREATING: 'Đang xử lý',
  IMPROVING: 'Đang cải thiện',
  CLOSED: 'Đã ổn',
  MONITORING: 'Đang theo dõi',
};
const LIFECYCLE_ORDER = ['DETECTED', 'CONFIRMED', 'TREATING', 'IMPROVING', 'CLOSED'] as const;

export interface ParentViewInput {
  readonly profile: ChildProfileInput;
  readonly twin: ChildLearningTwin;
  readonly gaps: GapEngineResult;
  readonly context: LearningContext;
  readonly plan: DailyPlanResult;
  readonly knowledgeBase: KnowledgeBase;
  readonly examCountdownDays?: number;
}

export function buildParentHome(input: ParentViewInput): ParentHomeView {
  const { twin, gaps, context, plan, knowledgeBase: kb } = input;

  const attention: AttentionItem[] = [];
  for (const g of gaps.gaps.filter((x) => x.type !== 'careless_error').slice(0, 2)) {
    const skillName = kb.skills.get(g.rootSkillId)?.name ?? g.rootSkillId;
    attention.push({
      gapId: g.id,
      title: `Con đang cần củng cố ${lower(skillName)}`,
      urgency: URGENCY[g.score.band],
      note: g.rationale,
      kind: 'gap',
    });
  }
  if (input.examCountdownDays !== undefined && input.examCountdownDays <= 21) {
    attention.push({
      gapId: '',
      title: `Còn ${input.examCountdownDays} ngày tới kỳ kiểm tra`,
      urgency: input.examCountdownDays <= 7 ? 'cao' : 'trung_bình',
      note: 'App đã đưa phần ôn liên quan vào kế hoạch.',
      kind: 'exam',
    });
  }

  const insights: string[] = [];
  for (const f of twin.frontier) {
    if (f.aboveGrade) {
      insights.push(
        `${domainVi(f.domain)} đang tiếp cận nội dung vượt chuẩn lớp ${input.profile.schoolGrade}`,
      );
    }
  }
  if (insights.length === 0 && twin.frontier.length > 0) {
    insights.push('Con đang theo sát chương trình ở các phần đã học.');
  }

  const challenge = gaps.gaps.length >= 0 ? { title: '1 bài tư duy · Giao cho con', available: true } : null;

  return {
    child: childSummary(input.profile),
    learningContext: {
      headline: activeSkillHeadline(
        context.actualTaughtPosition.skillIds.length > 0
          ? context.actualTaughtPosition.skillIds
          : context.activeSkillIds,
        kb,
      ),
      sources: contextSources(context),
      needsUpdate: !context.teacherParticipated && context.activeSkillIds.length === 0,
    },
    todayPlan: todayPlanView(plan),
    attention,
    progressInsights: insights.slice(0, 3),
    thinkingChallenge: challenge,
  };
}

export function buildParentProgress(input: ParentViewInput): ParentProgressView {
  const { twin, knowledgeBase: kb } = input;
  const target = masteryTargetFor();

  const knowledge: SkillProgressRow[] = [...twin.skillMastery.entries()]
    .map(([skillId, s]) => ({
      skillId,
      name: kb.skills.get(skillId)?.name ?? skillId,
      currentPercent: Math.round(s.mastery),
      targetPercent: target,
      status: statusWord(s.mastery, target),
    }))
    .sort((a, b) => b.currentPercent - a.currentPercent);

  const problemTypes: SkillProgressRow[] = [...twin.problemTypeMastery.entries()].map(([ptId, s]) => ({
    skillId: ptId,
    name: kb.problemTypes.find((p) => p.id === ptId)?.name ?? ptId,
    currentPercent: Math.round(s.mastery),
    targetPercent: target,
    status: statusWord(s.mastery, target),
  }));

  const thinking: SkillProgressRow[] = [...twin.thinkingProfile.entries()].map(([dim, s]) => ({
    skillId: dim,
    name: thinkingDimVi(dim),
    currentPercent: Math.round(s.score),
    targetPercent: target,
    status: statusWord(s.score, target),
  }));

  const frontierInsight =
    twin.frontier.find((f) => f.aboveGrade) !== undefined
      ? `${domainVi(twin.frontier.find((f) => f.aboveGrade)!.domain)} đang tiếp cận nội dung vượt chuẩn lớp ${input.profile.schoolGrade}, trong khi vài phần khác vẫn cần củng cố. Hai việc này chạy song song được.`
      : 'Con đang theo sát chương trình ở các phần đã học.';

  return {
    child: childSummary(input.profile),
    frontierInsight,
    axes: { knowledge, problemTypes, thinking },
    recentEvidence: recentEvidenceRows(input),
  };
}

export function buildParentGapDetail(input: ParentViewInput, gapId: string): ParentGapDetailView | null {
  const gap = input.gaps.gaps.find((g) => g.id === gapId);
  if (!gap) return null;
  const kb = input.knowledgeBase;
  const rx = input.gaps.prescriptions.find((p) => p.gapId === gapId);

  const reachedIndex = LIFECYCLE_ORDER.indexOf(gap.lifecycleState as (typeof LIFECYCLE_ORDER)[number]);
  const lifecycleStep = LIFECYCLE_ORDER.map((state, i) => ({
    label: LIFECYCLE_LABEL[state]!,
    state: (i < reachedIndex ? 'done' : i === reachedIndex ? 'current' : 'todo') as 'done' | 'current' | 'todo',
  }));

  return {
    gapId: gap.id,
    title: kb.skills.get(gap.rootSkillId)?.name ?? gap.rootSkillId,
    priorityLabel: PRIORITY[gap.score.band],
    lifecycleLabel: LIFECYCLE_LABEL[gap.lifecycleState] ?? gap.lifecycleState,
    whyAppThinks: [gap.rationale],
    affects: kb.dependents(gap.rootSkillId).map((id) => kb.skills.get(id)?.name ?? id).slice(0, 4),
    lifecycleStep,
    prescription: rx ? prescriptionView(rx) : null,
  };
}

function prescriptionView(rx: NonNullable<GapEngineResult['prescriptions'][number]>): ParentPrescriptionView {
  return {
    summary: `${rx.sessions} phiên × ${rx.minutesPerSession} phút trong ${rx.durationDays} ngày`,
    perSession: [
      { label: 'Bài củng cố', count: `${rx.dose.foundation} bài` },
      { label: 'Bài vận dụng', count: `${rx.dose.standard + rx.dose.application} bài` },
      { label: 'Bài tư duy', count: `${rx.dose.thinking} bài` },
      { label: 'Kiểm tra lại', count: `${rx.retestItems} câu` },
    ],
    rationale: rx.rationale,
    options: rx.options.map((o) => ({
      key: o.key,
      label: o.label,
      detail: `${o.sessions} phiên × ${o.minutesPerSession}′`,
    })),
  };
}

// --- helpers ---
function contextSources(context: LearningContext): string[] {
  const out: string[] = [];
  if (context.teacherParticipated) out.push('Giáo viên xác nhận');
  if (context.activeSkillIds.length > 0 && !context.teacherParticipated) out.push('Từ bài con đã làm');
  if (context.conflicts.length > 0) out.push('Có nguồn chưa khớp — cần xem lại');
  return out.length > 0 ? out : ['Chưa có cập nhật'];
}

function recentEvidenceRows(input: ParentViewInput): ParentProgressView['recentEvidence'] {
  const rows: { label: string; detail: string; source: string }[] = [];
  if (input.context.teacherParticipated) {
    rows.push({ label: 'Giáo viên cập nhật', detail: 'Nội dung đã dạy gần đây', source: 'teacher' });
  }
  for (const g of input.gaps.gaps.slice(0, 2)) {
    rows.push({
      label: 'App phát hiện điểm cần củng cố',
      detail: input.knowledgeBase.skills.get(g.rootSkillId)?.name ?? g.rootSkillId,
      source: 'app',
    });
  }
  return rows;
}

const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

function domainVi(d: string): string {
  const map: Record<string, string> = {
    algebraic_thinking: 'Đại số',
    arithmetic: 'Số học',
    fractions: 'Phân số',
    word_problems: 'Toán có lời văn',
    geometry: 'Hình học',
    number_sense: 'Số học',
  };
  return map[d] ?? d;
}
function thinkingDimVi(d: string): string {
  const map: Record<string, string> = {
    algebraic_thinking: 'Tư duy đại số',
    strategic_choice: 'Chọn chiến lược',
    problem_representation: 'Biểu diễn bài toán',
    pattern_recognition: 'Nhận diện quy luật',
    proof_explanation: 'Giải thích, chứng minh',
    number_sense: 'Cảm giác số',
    reverse_reasoning: 'Suy luận ngược',
  };
  return map[d] ?? d;
}
