import type { Pool } from 'pg';
import {
  asChildId,
  asProblemTypeId,
  asSkillId,
  type ChildId,
  type Evidence,
  type LessonConfirmationEvent,
  type SkillId,
  type TeacherContribution,
} from '@copilot/domain';
import type { LedgerStore } from './store.js';

/**
 * PostgreSQL ledger backend. INSERT-only — this class issues no UPDATE/DELETE, and
 * the `evidence` / `teacher_contributions` tables carry triggers that raise on
 * UPDATE/DELETE regardless of caller (see migration *_evidence_ledger).
 */
export class PgLedgerStore implements LedgerStore {
  constructor(private readonly pool: Pool) {}

  async appendEvidence(r: Evidence): Promise<void> {
    await this.pool.query(
      `INSERT INTO evidence
         (id, child_id, source, occurred_at, recorded_at, skill_id, problem_type_id,
          result, reasoning_quality, hint_dependency, time_spent_seconds,
          confidence_tier, provenance, ai_inference_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        r.id,
        r.childId,
        r.source,
        r.occurredAt,
        r.recordedAt,
        r.skillId ?? null,
        r.problemTypeId ?? null,
        JSON.stringify(r.result),
        r.reasoningQuality ?? null,
        r.hintDependency ?? null,
        r.timeSpentSeconds ?? null,
        r.confidenceTier,
        r.provenance,
        r.aiInferenceId ?? null,
      ],
    );
  }

  async appendTeacherContribution(r: TeacherContribution): Promise<void> {
    await this.pool.query(
      `INSERT INTO teacher_contributions
         (id, child_id, contributed_as, actor_user_id, occurred_on, recorded_at,
          taught_skill_ids, problem_type_ids, homework_refs, exam_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        r.id,
        r.childId,
        r.contributedAs,
        r.actorUserId,
        r.occurredOn,
        r.recordedAt,
        JSON.stringify(r.taughtSkillIds),
        JSON.stringify(r.problemTypeIds),
        JSON.stringify(r.homeworkRefs),
        r.examRef ? JSON.stringify(r.examRef) : null,
      ],
    );
  }

  async listEvidence(childId: ChildId): Promise<readonly Evidence[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM evidence WHERE child_id = $1 ORDER BY occurred_at ASC, recorded_at ASC`,
      [childId],
    );
    return rows.map(rowToEvidence);
  }

  async listEvidenceForSkill(childId: ChildId, skillId: SkillId): Promise<readonly Evidence[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM evidence WHERE child_id = $1 AND skill_id = $2
       ORDER BY occurred_at ASC, recorded_at ASC`,
      [childId, skillId],
    );
    return rows.map(rowToEvidence);
  }

  async listTeacherContributions(childId: ChildId): Promise<readonly TeacherContribution[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM teacher_contributions WHERE child_id = $1 ORDER BY occurred_on ASC`,
      [childId],
    );
    return rows.map(rowToContribution);
  }

  async countEvidence(childId: ChildId): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM evidence WHERE child_id = $1`,
      [childId],
    );
    return Number(rows[0]?.count ?? '0');
  }

  async appendLessonConfirmation(r: LessonConfirmationEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO lesson_confirmations
         (id, child_id, lesson_id, topic_note, source, confidence, confirmed_by, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [r.id, r.childId, r.lessonId, r.topicNote ?? null, r.source, r.confidence, r.confirmedBy, r.confirmedAt],
    );
  }

  async listLessonConfirmations(childId: ChildId): Promise<readonly LessonConfirmationEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM lesson_confirmations WHERE child_id = $1 ORDER BY confirmed_at ASC`,
      [childId],
    );
    return rows.map(
      (row: Record<string, unknown>): LessonConfirmationEvent => ({
        id: row.id as string,
        childId: asChildId(row.child_id as string),
        lessonId: row.lesson_id as string,
        ...(row.topic_note ? { topicNote: row.topic_note as string } : {}),
        source: row.source as LessonConfirmationEvent['source'],
        confidence: row.confidence as LessonConfirmationEvent['confidence'],
        confirmedBy: row.confirmed_by as string,
        confirmedAt: new Date(row.confirmed_at as string).toISOString(),
      }),
    );
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- pg returns untyped rows; narrowed here. */
function rowToEvidence(row: any): Evidence {
  return {
    id: row.id,
    childId: asChildId(row.child_id),
    source: row.source,
    occurredAt: new Date(row.occurred_at).toISOString(),
    recordedAt: new Date(row.recorded_at).toISOString(),
    ...(row.skill_id ? { skillId: asSkillId(row.skill_id) } : {}),
    ...(row.problem_type_id ? { problemTypeId: asProblemTypeId(row.problem_type_id) } : {}),
    result: typeof row.result === 'string' ? JSON.parse(row.result) : row.result,
    ...(row.reasoning_quality ? { reasoningQuality: row.reasoning_quality } : {}),
    ...(row.hint_dependency !== null ? { hintDependency: Number(row.hint_dependency) } : {}),
    ...(row.time_spent_seconds !== null ? { timeSpentSeconds: Number(row.time_spent_seconds) } : {}),
    confidenceTier: row.confidence_tier,
    provenance: row.provenance,
    ...(row.ai_inference_id ? { aiInferenceId: row.ai_inference_id } : {}),
  };
}

function rowToContribution(row: any): TeacherContribution {
  const parse = (v: unknown): any[] =>
    typeof v === 'string' ? (JSON.parse(v) as any[]) : Array.isArray(v) ? v : [];
  return {
    id: row.id,
    childId: asChildId(row.child_id),
    contributedAs: row.contributed_as,
    actorUserId: row.actor_user_id,
    occurredOn: typeof row.occurred_on === 'string' ? row.occurred_on : row.occurred_on.toISOString().slice(0, 10),
    recordedAt: new Date(row.recorded_at).toISOString(),
    taughtSkillIds: parse(row.taught_skill_ids).map(asSkillId),
    problemTypeIds: parse(row.problem_type_ids).map(asSkillId),
    homeworkRefs: parse(row.homework_refs),
    ...(row.exam_ref
      ? { examRef: typeof row.exam_ref === 'string' ? JSON.parse(row.exam_ref) : row.exam_ref }
      : {}),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
