import type { Pool, PoolClient } from 'pg';
import type {
  AssignmentItemRow,
  AssignmentRow,
  AttemptAnswerRow,
  AttemptRow,
  LearningSnapshotKind,
  LearningStateSnapshot,
  PersistedGapRow,
  PersistedPlanRow,
  SkillStateRow,
} from '@copilot/domain';
import type { LearningStateStore, NewAssignment, NewAttemptAnswer } from './store.js';

type Queryable = Pool | PoolClient;
/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoN = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const dateN = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v).slice(0, 10));
const num = (v: unknown): number => Number(v);
const numN = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export class PgLearningStateStore implements LearningStateStore {
  constructor(private readonly pool: Queryable) {}

  async putSnapshot(s: LearningStateSnapshot): Promise<void> {
    await this.pool.query(
      `INSERT INTO learning_state_snapshots (child_id, kind, state, state_version, evidence_count, content_hash, provenance, computed_at)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT (child_id, kind) DO UPDATE SET
         state = EXCLUDED.state, state_version = EXCLUDED.state_version,
         evidence_count = EXCLUDED.evidence_count, content_hash = EXCLUDED.content_hash,
         provenance = EXCLUDED.provenance, computed_at = EXCLUDED.computed_at`,
      [
        s.childId, s.kind, JSON.stringify(s.state), s.stateVersion, s.evidenceCount, s.contentHash,
        JSON.stringify(s.provenance), s.computedAt,
      ],
    );
  }
  async getSnapshot(childId: string, kind: LearningSnapshotKind): Promise<LearningStateSnapshot | null> {
    const r = await this.pool.query(`SELECT * FROM learning_state_snapshots WHERE child_id = $1 AND kind = $2`, [childId, kind]);
    const x = r.rows[0] as any;
    return x
      ? {
          childId: x.child_id,
          kind: x.kind,
          state: x.state,
          stateVersion: x.state_version,
          evidenceCount: x.evidence_count,
          contentHash: x.content_hash,
          provenance: x.provenance ?? {},
          computedAt: iso(x.computed_at),
        }
      : null;
  }

  async replaceSkillStates(childId: string, rows: readonly SkillStateRow[]): Promise<void> {
    await this.pool.query(`DELETE FROM skill_states WHERE child_id = $1`, [childId]);
    for (const s of rows) {
      await this.pool.query(
        `INSERT INTO skill_states (child_id, skill_id, mastery, confidence, retention, evidence_count,
           last_observed_at, last_verified_at, computed_from_evidence_count, computed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          childId, s.skillId, s.mastery, s.confidence, s.retention, s.evidenceCount, s.lastObservedAt,
          s.lastVerifiedAt, s.computedFromEvidenceCount, s.computedAt,
        ],
      );
    }
  }
  async listSkillStates(childId: string): Promise<readonly SkillStateRow[]> {
    const r = await this.pool.query(`SELECT * FROM skill_states WHERE child_id = $1 ORDER BY skill_id`, [childId]);
    return r.rows.map((x: any) => ({
      childId: x.child_id,
      skillId: x.skill_id,
      mastery: num(x.mastery),
      confidence: num(x.confidence),
      retention: numN(x.retention),
      evidenceCount: x.evidence_count,
      lastObservedAt: isoN(x.last_observed_at),
      lastVerifiedAt: isoN(x.last_verified_at),
      computedFromEvidenceCount: x.computed_from_evidence_count,
      computedAt: iso(x.computed_at),
    }));
  }

  async replaceGaps(childId: string, rows: readonly PersistedGapRow[]): Promise<void> {
    await this.pool.query(`DELETE FROM knowledge_gaps WHERE child_id = $1`, [childId]);
    for (const g of rows) {
      await this.pool.query(
        `INSERT INTO knowledge_gaps (id, child_id, gap_type, target_skill_id, root_skill_id, severity,
           priority, lifecycle_state, blocks_current_learning, blocks_advanced_learning, rationale,
           evidence_refs, detected_at, updated_at, computed_from_evidence_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)`,
        [
          g.id, childId, g.gapType, g.targetSkillId, g.rootSkillId, g.severity, g.priority, g.lifecycleState,
          g.blocksCurrentLearning, g.blocksAdvancedLearning, g.rationale, JSON.stringify(g.evidenceRefs),
          g.detectedAt, g.updatedAt, g.computedFromEvidenceCount,
        ],
      );
    }
  }
  async listGaps(childId: string): Promise<readonly PersistedGapRow[]> {
    const r = await this.pool.query(`SELECT * FROM knowledge_gaps WHERE child_id = $1 ORDER BY priority DESC`, [childId]);
    return r.rows.map((x: any) => ({
      id: x.id,
      childId: x.child_id,
      gapType: x.gap_type,
      targetSkillId: x.target_skill_id,
      rootSkillId: x.root_skill_id ?? null,
      severity: num(x.severity),
      priority: num(x.priority),
      lifecycleState: x.lifecycle_state,
      blocksCurrentLearning: x.blocks_current_learning,
      blocksAdvancedLearning: x.blocks_advanced_learning,
      rationale: x.rationale ?? null,
      evidenceRefs: Array.isArray(x.evidence_refs) ? x.evidence_refs : [],
      detectedAt: iso(x.detected_at),
      updatedAt: iso(x.updated_at),
      computedFromEvidenceCount: x.computed_from_evidence_count,
    }));
  }

  async savePlan(plan: PersistedPlanRow): Promise<void> {
    await this.pool.query(`DELETE FROM learning_plans WHERE child_id = $1 AND plan_date = $2`, [plan.childId, plan.planDate]);
    const r = await this.pool.query(
      `INSERT INTO learning_plans (id, child_id, plan_date, available_minutes, kind, mix, planner_version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id`,
      [
        plan.id, plan.childId, plan.planDate, plan.availableMinutes, plan.kind, JSON.stringify(plan.mix),
        plan.plannerVersion, plan.createdAt,
      ],
    );
    const planId = (r.rows[0] as any).id;
    for (const it of plan.items) {
      await this.pool.query(
        `INSERT INTO plan_items (learning_plan_id, order_index, action_kind, skill_id, minutes, payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [planId, it.orderIndex, it.actionKind, it.skillId, it.minutes, JSON.stringify(it.payload)],
      );
    }
  }
  async getPlan(childId: string, planDate: string): Promise<PersistedPlanRow | null> {
    const r = await this.pool.query(`SELECT * FROM learning_plans WHERE child_id = $1 AND plan_date = $2`, [childId, planDate]);
    const x = r.rows[0] as any;
    if (!x) return null;
    const items = await this.pool.query(`SELECT * FROM plan_items WHERE learning_plan_id = $1 ORDER BY order_index`, [x.id]);
    return {
      id: x.id,
      childId: x.child_id,
      planDate: dateN(x.plan_date)!,
      availableMinutes: x.available_minutes,
      kind: x.kind,
      mix: x.mix ?? {},
      plannerVersion: x.planner_version ?? null,
      createdAt: iso(x.created_at),
      items: items.rows.map((i: any) => ({
        orderIndex: i.order_index,
        actionKind: i.action_kind,
        skillId: i.skill_id ?? null,
        minutes: i.minutes,
        payload: i.payload ?? {},
      })),
    };
  }

  async createAssignment(input: NewAssignment): Promise<AssignmentRow> {
    const r = await this.pool.query(
      `INSERT INTO assignments (child_id, learning_plan_id, subject_id, assigned_by_user_id, assigned_by_role,
         source, generation_spec_id, generated_exercise_set_id, mode, target_skill_ids, status, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'ASSIGNED',$11) RETURNING *`,
      [
        input.childId, input.learningPlanId ?? null, input.subjectId ?? null, input.assignedByUserId ?? null,
        input.assignedByRole ?? null, input.source, input.generationSpecId ?? null,
        input.generatedExerciseSetId ?? null, input.mode ?? 'WORKSHEET', JSON.stringify(input.targetSkillIds),
        input.dueDate ?? null,
      ],
    );
    const a = r.rows[0] as any;
    for (const [i, it] of input.items.entries()) {
      await this.pool.query(
        `INSERT INTO assignment_items (assignment_id, order_index, question_ref, skill_id, problem_type_id,
           knowledge_level, thinking_level, prompt, answer_spec, hints)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)`,
        [
          a.id, it.orderIndex ?? i, it.questionRef ?? null, it.skillId ?? null, it.problemTypeId ?? null,
          it.knowledgeLevel ?? null, it.thinkingLevel ?? null, JSON.stringify(it.prompt),
          JSON.stringify(it.answerSpec), JSON.stringify(it.hints ?? []),
        ],
      );
    }
    return rowToAssignment(a);
  }
  async getAssignment(id: string): Promise<{ assignment: AssignmentRow; items: readonly AssignmentItemRow[] } | null> {
    const r = await this.pool.query(`SELECT * FROM assignments WHERE id = $1`, [id]);
    if (!r.rows[0]) return null;
    const items = await this.pool.query(`SELECT * FROM assignment_items WHERE assignment_id = $1 ORDER BY order_index`, [id]);
    return {
      assignment: rowToAssignment(r.rows[0]),
      items: items.rows.map((x: any) => ({
        id: x.id,
        assignmentId: x.assignment_id,
        orderIndex: x.order_index,
        questionRef: x.question_ref ?? null,
        skillId: x.skill_id ?? null,
        problemTypeId: x.problem_type_id ?? null,
        knowledgeLevel: numN(x.knowledge_level),
        thinkingLevel: numN(x.thinking_level),
        prompt: x.prompt,
        answerSpec: x.answer_spec,
        hints: Array.isArray(x.hints) ? x.hints : [],
      })),
    };
  }
  async listAssignmentsForChild(childId: string): Promise<readonly AssignmentRow[]> {
    const r = await this.pool.query(`SELECT * FROM assignments WHERE child_id = $1 ORDER BY created_at DESC`, [childId]);
    return r.rows.map(rowToAssignment);
  }
  async updateAssignmentStatus(id: string, status: AssignmentRow['status']): Promise<void> {
    await this.pool.query(
      `UPDATE assignments SET status = $2, completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() ELSE completed_at END WHERE id = $1`,
      [id, status],
    );
  }

  async startAttempt(input: { assignmentId: string | null; childId: string }): Promise<AttemptRow> {
    const r = await this.pool.query(
      `INSERT INTO attempts (assignment_id, child_id, status) VALUES ($1,$2,'IN_PROGRESS') RETURNING *`,
      [input.assignmentId, input.childId],
    );
    return rowToAttempt(r.rows[0]);
  }
  async submitAttempt(attemptId: string, answers: readonly NewAttemptAnswer[]): Promise<AttemptRow> {
    for (const a of answers) {
      await this.pool.query(
        `INSERT INTO attempt_answers (attempt_id, assignment_item_id, child_answer, hints_used, reasoning_text,
           time_spent_seconds, verification_level, correct, verified_at, evidence_id)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10)`,
        [
          attemptId, a.assignmentItemId, JSON.stringify(a.childAnswer), a.hintsUsed ?? 0, a.reasoningText ?? null,
          a.timeSpentSeconds ?? null, a.verificationLevel, a.correct ?? null, a.verifiedAt ?? null, a.evidenceId ?? null,
        ],
      );
    }
    const r = await this.pool.query(
      `UPDATE attempts SET status = 'SUBMITTED', submitted_at = now() WHERE id = $1 AND status = 'IN_PROGRESS' RETURNING *`,
      [attemptId],
    );
    if (!r.rows[0]) throw new Error(`attempt ${attemptId} not in progress`);
    return rowToAttempt(r.rows[0]);
  }
  async listAttempts(childId: string): Promise<readonly AttemptRow[]> {
    const r = await this.pool.query(`SELECT * FROM attempts WHERE child_id = $1 ORDER BY started_at DESC`, [childId]);
    return r.rows.map(rowToAttempt);
  }
  async listAttemptAnswers(attemptId: string): Promise<readonly AttemptAnswerRow[]> {
    const r = await this.pool.query(`SELECT * FROM attempt_answers WHERE attempt_id = $1 ORDER BY created_at`, [attemptId]);
    return r.rows.map((x: any) => ({
      id: x.id,
      attemptId: x.attempt_id,
      assignmentItemId: x.assignment_item_id,
      childAnswer: x.child_answer,
      hintsUsed: x.hints_used,
      reasoningText: x.reasoning_text ?? null,
      timeSpentSeconds: numN(x.time_spent_seconds),
      verificationLevel: x.verification_level,
      correct: x.correct ?? null,
      verifiedAt: isoN(x.verified_at),
      evidenceId: x.evidence_id ?? null,
      createdAt: iso(x.created_at),
    }));
  }

  async invalidateDerived(childId: string): Promise<void> {
    await this.pool.query(`DELETE FROM learning_state_snapshots WHERE child_id = $1`, [childId]);
    await this.pool.query(`DELETE FROM skill_states WHERE child_id = $1`, [childId]);
    await this.pool.query(`DELETE FROM problem_type_mastery WHERE child_id = $1`, [childId]);
    await this.pool.query(`DELETE FROM thinking_state WHERE child_id = $1`, [childId]);
    await this.pool.query(`DELETE FROM knowledge_gaps WHERE child_id = $1`, [childId]);
    await this.pool.query(`DELETE FROM gap_prescriptions WHERE child_id = $1`, [childId]);
    await this.pool.query(`DELETE FROM learning_plans WHERE child_id = $1`, [childId]);
  }
}

function rowToAssignment(x: any): AssignmentRow {
  return {
    id: x.id,
    childId: x.child_id,
    learningPlanId: x.learning_plan_id ?? null,
    subjectId: x.subject_id ?? null,
    assignedByUserId: x.assigned_by_user_id ?? null,
    assignedByRole: x.assigned_by_role ?? null,
    source: x.source,
    generationSpecId: x.generation_spec_id ?? null,
    generatedExerciseSetId: x.generated_exercise_set_id ?? null,
    mode: x.mode,
    targetSkillIds: Array.isArray(x.target_skill_ids) ? x.target_skill_ids : [],
    status: x.status,
    dueDate: dateN(x.due_date),
    createdAt: iso(x.created_at),
    completedAt: isoN(x.completed_at),
  };
}
function rowToAttempt(x: any): AttemptRow {
  return {
    id: x.id,
    assignmentId: x.assignment_id ?? null,
    childId: x.child_id,
    status: x.status,
    startedAt: iso(x.started_at),
    submittedAt: isoN(x.submitted_at),
  };
}
