import {
  asSkillId,
  type ChildId,
  type Domain,
  type Evidence,
  type GradeContext,
  type LearningContext,
  type SkillId,
  type TeacherContribution,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';

export interface BuildContextInput {
  readonly childId: ChildId;
  readonly gradeContext: GradeContext;
  readonly evidence: readonly Evidence[];
  readonly teacherContributions: readonly TeacherContribution[];
  readonly knowledgeBase: KnowledgeBase;
  /** "Now" for recency windows. Injectable for tests. */
  readonly asOf?: Date;
  /** How many days back counts as "actively being learned". */
  readonly recencyDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure builder for LearningContext (Phase 2). Deterministic over its inputs — no
 * I/O, no AI. MUST produce a usable context with zero teacher contributions
 * (parent-only path is the default, not a degraded mode).
 */
export function buildLearningContext(input: BuildContextInput): LearningContext {
  const { childId, gradeContext, evidence, teacherContributions, knowledgeBase: kb } = input;
  const asOf = input.asOf ?? new Date();
  const recencyDays = input.recencyDays ?? 21;
  const cutoff = asOf.getTime() - recencyDays * DAY_MS;

  const known = (id: SkillId): boolean => kb.skills.has(id);
  const recent = (iso: string): boolean => Date.parse(iso) >= cutoff;

  // --- active skills: recent app/scan/assessment evidence, most-recent first ---
  const evidenceBySkillRecency = [...evidence]
    .filter((e) => e.skillId && known(e.skillId) && recent(e.occurredAt))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const activeFromEvidence = dedupe(evidenceBySkillRecency.map((e) => e.skillId as SkillId));

  // --- what teachers/parents say was taught recently ---
  const recentContribs = teacherContributions.filter((c) => recent(`${c.occurredOn}T00:00:00Z`));
  const taughtSkillIds = dedupe(
    recentContribs.flatMap((c) => c.taughtSkillIds).filter(known),
  );

  const activeSkillIds = dedupe([...taughtSkillIds, ...activeFromEvidence]);

  // --- standard position: whole-grade scope (calendar not yet modelled) ---
  const standardSkillIds = [...kb.skills.values()]
    .filter((s) => s.gradeContext === gradeContext)
    .map((s) => asSkillId(s.id));

  // --- frontier per domain: furthest curriculum origin reached with any evidence ---
  const frontier = buildFrontier(evidence, kb, gradeContext);

  // --- conflicts: teacher says X, the app only sees work on a disjoint set ---
  const conflicts =
    taughtSkillIds.length > 0 &&
    activeFromEvidence.length > 0 &&
    !taughtSkillIds.some((s) => activeFromEvidence.includes(s))
      ? [
          {
            skillId: taughtSkillIds[0]!,
            reason:
              'Nguồn giáo viên và bài con làm gần đây đang chỉ về hai chủ đề khác nhau — bố mẹ xác nhận giúp.',
            sources: ['teacher_contribution', 'app_evidence'],
          },
        ]
      : [];

  return {
    childId,
    builtAt: asOf.toISOString(),
    standardPosition: {
      skillIds: standardSkillIds,
      note: 'Phạm vi chuẩn theo lớp; lịch trình theo tuần chưa được cấu hình.',
    },
    actualTaughtPosition: {
      skillIds: taughtSkillIds.length > 0 ? taughtSkillIds : activeFromEvidence,
      note:
        taughtSkillIds.length > 0
          ? 'Từ cập nhật của giáo viên/bố mẹ.'
          : 'Suy ra từ bài con đã làm (chưa có cập nhật của giáo viên).',
    },
    frontier,
    activeSkillIds,
    teacherParticipated: teacherContributions.length > 0,
    conflicts,
  };
}

function buildFrontier(
  evidence: readonly Evidence[],
  kb: KnowledgeBase,
  gradeContext: GradeContext,
): LearningContext['frontier'] {
  const byDomain = new Map<Domain, { maxOrigin: number; count: number }>();
  for (const e of evidence) {
    if (!e.skillId) continue;
    const skill = kb.skills.get(e.skillId);
    if (!skill) continue;
    const positive = e.result.correct === true || (e.result.score ?? 0) > 0.5;
    const entry = byDomain.get(skill.domain) ?? { maxOrigin: 0, count: 0 };
    entry.count += 1;
    if (positive) entry.maxOrigin = Math.max(entry.maxOrigin, skill.curriculumOrigin);
    byDomain.set(skill.domain, entry);
  }

  return [...byDomain.entries()]
    .filter(([, v]) => v.maxOrigin > 0)
    .map(([domain, v]) => ({
      domain,
      frontierLabel:
        v.maxOrigin > gradeContext
          ? `above_grade_G${v.maxOrigin}_exposure`
          : `grade_${gradeContext}_context`,
      evidenceCount: v.count,
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

function dedupe(ids: readonly SkillId[]): SkillId[] {
  return [...new Set(ids)];
}
