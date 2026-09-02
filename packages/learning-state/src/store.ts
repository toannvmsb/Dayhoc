import { createHash } from 'node:crypto';
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

/** Deterministic content hash for a snapshot blob (staleness detection). */
export function snapshotHash(state: unknown): string {
  return createHash('sha256').update(stableStringify(state)).digest('hex').slice(0, 32);
}
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

export interface NewAssignment {
  readonly id?: string;
  readonly childId: string;
  readonly learningPlanId?: string | null;
  readonly subjectId?: string | null;
  readonly assignedByUserId?: string | null;
  readonly assignedByRole?: 'PARENT' | 'TEACHER' | 'SYSTEM' | null;
  readonly source: 'LEGACY_PRACTICE' | 'AI_GENERATED';
  readonly generationSpecId?: string | null;
  readonly generatedExerciseSetId?: string | null;
  readonly mode?: string;
  readonly targetSkillIds: readonly string[];
  readonly dueDate?: string | null;
  readonly items: ReadonlyArray<Omit<AssignmentItemRow, 'id' | 'assignmentId'>>;
}

export interface NewAttemptAnswer {
  readonly assignmentItemId: string;
  readonly childAnswer: unknown;
  readonly hintsUsed?: number;
  readonly reasoningText?: string | null;
  readonly timeSpentSeconds?: number | null;
  readonly verificationLevel: string;
  readonly correct?: boolean | null;
  readonly verifiedAt?: string | null;
  readonly evidenceId?: string | null;
}

/**
 * Persistence port for derived learning state + genuine student work
 * (migration group IX). Derived rows are replace-on-recompute; `attempts` /
 * `attempt_answers` are append-only. `child_id` is the durable owner.
 */
export interface LearningStateStore {
  // --- derived: whole-twin snapshot ---
  putSnapshot(snapshot: LearningStateSnapshot): Promise<void>;
  getSnapshot(childId: string, kind: LearningSnapshotKind): Promise<LearningStateSnapshot | null>;

  // --- derived: structured rows (replace on recompute) ---
  replaceSkillStates(childId: string, rows: readonly SkillStateRow[]): Promise<void>;
  listSkillStates(childId: string): Promise<readonly SkillStateRow[]>;
  replaceGaps(childId: string, rows: readonly PersistedGapRow[]): Promise<void>;
  listGaps(childId: string): Promise<readonly PersistedGapRow[]>;
  savePlan(plan: PersistedPlanRow): Promise<void>;
  getPlan(childId: string, planDate: string): Promise<PersistedPlanRow | null>;

  // --- genuine student work ---
  createAssignment(input: NewAssignment): Promise<AssignmentRow>;
  getAssignment(id: string): Promise<{ assignment: AssignmentRow; items: readonly AssignmentItemRow[] } | null>;
  listAssignmentsForChild(childId: string): Promise<readonly AssignmentRow[]>;
  updateAssignmentStatus(id: string, status: AssignmentRow['status']): Promise<void>;

  startAttempt(input: { assignmentId: string | null; childId: string; id?: string }): Promise<AttemptRow>;
  submitAttempt(attemptId: string, answers: readonly NewAttemptAnswer[]): Promise<AttemptRow>;
  listAttempts(childId: string): Promise<readonly AttemptRow[]>;
  listAttemptAnswers(attemptId: string): Promise<readonly AttemptAnswerRow[]>;

  /** Wipe every DERIVED row for a child (a full rebuild from evidence follows). */
  invalidateDerived(childId: string): Promise<void>;
}

// ---------------------------------------------------------------------------

const clone = <T>(v: T): T => structuredClone(v);

export class InMemoryLearningStateStore implements LearningStateStore {
  #snapshots = new Map<string, LearningStateSnapshot>();
  #skillStates = new Map<string, SkillStateRow[]>();
  #gaps = new Map<string, PersistedGapRow[]>();
  #plans = new Map<string, PersistedPlanRow>();
  #assignments = new Map<string, AssignmentRow>();
  #assignmentItems = new Map<string, AssignmentItemRow[]>();
  #attempts = new Map<string, AttemptRow>();
  #answers = new Map<string, AttemptAnswerRow[]>();
  #seq = 0;
  #id(prefix: string): string {
    this.#seq += 1;
    return `${prefix}_${this.#seq.toString().padStart(4, '0')}`;
  }

  putSnapshot(s: LearningStateSnapshot): Promise<void> {
    this.#snapshots.set(`${s.childId}:${s.kind}`, clone(s));
    return Promise.resolve();
  }
  getSnapshot(childId: string, kind: LearningSnapshotKind): Promise<LearningStateSnapshot | null> {
    const s = this.#snapshots.get(`${childId}:${kind}`);
    return Promise.resolve(s ? clone(s) : null);
  }

  replaceSkillStates(childId: string, rows: readonly SkillStateRow[]): Promise<void> {
    this.#skillStates.set(childId, rows.map(clone));
    return Promise.resolve();
  }
  listSkillStates(childId: string): Promise<readonly SkillStateRow[]> {
    return Promise.resolve((this.#skillStates.get(childId) ?? []).map(clone));
  }
  replaceGaps(childId: string, rows: readonly PersistedGapRow[]): Promise<void> {
    this.#gaps.set(childId, rows.map(clone));
    return Promise.resolve();
  }
  listGaps(childId: string): Promise<readonly PersistedGapRow[]> {
    return Promise.resolve((this.#gaps.get(childId) ?? []).map(clone));
  }
  savePlan(plan: PersistedPlanRow): Promise<void> {
    this.#plans.set(`${plan.childId}:${plan.planDate}`, clone(plan));
    return Promise.resolve();
  }
  getPlan(childId: string, planDate: string): Promise<PersistedPlanRow | null> {
    const p = this.#plans.get(`${childId}:${planDate}`);
    return Promise.resolve(p ? clone(p) : null);
  }

  createAssignment(input: NewAssignment): Promise<AssignmentRow> {
    const id = input.id ?? this.#id('asg');
    const row: AssignmentRow = {
      id,
      childId: input.childId,
      learningPlanId: input.learningPlanId ?? null,
      subjectId: input.subjectId ?? null,
      assignedByUserId: input.assignedByUserId ?? null,
      assignedByRole: input.assignedByRole ?? null,
      source: input.source,
      generationSpecId: input.generationSpecId ?? null,
      generatedExerciseSetId: input.generatedExerciseSetId ?? null,
      mode: input.mode ?? 'WORKSHEET',
      targetSkillIds: [...input.targetSkillIds],
      status: 'ASSIGNED',
      dueDate: input.dueDate ?? null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    this.#assignments.set(id, row);
    this.#assignmentItems.set(
      id,
      input.items.map((it, i) => ({ ...it, id: this.#id('item'), assignmentId: id, orderIndex: it.orderIndex ?? i })),
    );
    return Promise.resolve(clone(row));
  }
  getAssignment(id: string): Promise<{ assignment: AssignmentRow; items: readonly AssignmentItemRow[] } | null> {
    const a = this.#assignments.get(id);
    if (!a) return Promise.resolve(null);
    return Promise.resolve({ assignment: clone(a), items: (this.#assignmentItems.get(id) ?? []).map(clone) });
  }
  listAssignmentsForChild(childId: string): Promise<readonly AssignmentRow[]> {
    return Promise.resolve([...this.#assignments.values()].filter((a) => a.childId === childId).map(clone));
  }
  updateAssignmentStatus(id: string, status: AssignmentRow['status']): Promise<void> {
    const a = this.#assignments.get(id);
    if (!a) return Promise.reject(new Error(`assignment ${id} not found`));
    this.#assignments.set(id, {
      ...a,
      status,
      completedAt: status === 'COMPLETED' ? new Date().toISOString() : a.completedAt,
    });
    return Promise.resolve();
  }

  startAttempt(input: { assignmentId: string | null; childId: string; id?: string }): Promise<AttemptRow> {
    const id = input.id ?? this.#id('att');
    const row: AttemptRow = {
      id,
      assignmentId: input.assignmentId,
      childId: input.childId,
      status: 'IN_PROGRESS',
      startedAt: new Date().toISOString(),
      submittedAt: null,
    };
    this.#attempts.set(id, row);
    this.#answers.set(id, []);
    return Promise.resolve(clone(row));
  }
  submitAttempt(attemptId: string, answers: readonly NewAttemptAnswer[]): Promise<AttemptRow> {
    const a = this.#attempts.get(attemptId);
    if (!a) return Promise.reject(new Error(`attempt ${attemptId} not found`));
    if (a.status !== 'IN_PROGRESS') return Promise.reject(new Error('attempt already finalised'));
    const now = new Date().toISOString();
    this.#answers.set(
      attemptId,
      answers.map((ans) => ({
        id: this.#id('ans'),
        attemptId,
        assignmentItemId: ans.assignmentItemId,
        childAnswer: ans.childAnswer,
        hintsUsed: ans.hintsUsed ?? 0,
        reasoningText: ans.reasoningText ?? null,
        timeSpentSeconds: ans.timeSpentSeconds ?? null,
        verificationLevel: ans.verificationLevel,
        correct: ans.correct ?? null,
        verifiedAt: ans.verifiedAt ?? null,
        evidenceId: ans.evidenceId ?? null,
        createdAt: now,
      })),
    );
    const updated: AttemptRow = { ...a, status: 'SUBMITTED', submittedAt: now };
    this.#attempts.set(attemptId, updated);
    return Promise.resolve(clone(updated));
  }
  listAttempts(childId: string): Promise<readonly AttemptRow[]> {
    return Promise.resolve([...this.#attempts.values()].filter((a) => a.childId === childId).map(clone));
  }
  listAttemptAnswers(attemptId: string): Promise<readonly AttemptAnswerRow[]> {
    return Promise.resolve((this.#answers.get(attemptId) ?? []).map(clone));
  }

  invalidateDerived(childId: string): Promise<void> {
    for (const k of ['TWIN', 'GAPS', 'CONTEXT', 'FRONTIER']) this.#snapshots.delete(`${childId}:${k}`);
    this.#skillStates.delete(childId);
    this.#gaps.delete(childId);
    for (const key of [...this.#plans.keys()]) if (key.startsWith(`${childId}:`)) this.#plans.delete(key);
    return Promise.resolve();
  }
}
