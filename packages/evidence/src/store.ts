import type { ChildId, Evidence, SkillId, TeacherContribution } from '@copilot/domain';

/**
 * The ledger port. By construction it exposes **no update and no delete** — the
 * only mutation is `appendEvidence` / `appendTeacherContribution`. Any storage
 * backend implementing this interface inherits the append-only guarantee; the
 * Postgres backend additionally enforces it with triggers (defense in depth).
 */
export interface LedgerStore {
  appendEvidence(record: Evidence): Promise<void>;
  appendTeacherContribution(record: TeacherContribution): Promise<void>;

  /** All evidence for a child, oldest first (the ordered stream mastery is derived from). */
  listEvidence(childId: ChildId): Promise<readonly Evidence[]>;
  listEvidenceForSkill(childId: ChildId, skillId: SkillId): Promise<readonly Evidence[]>;
  listTeacherContributions(childId: ChildId): Promise<readonly TeacherContribution[]>;
  countEvidence(childId: ChildId): Promise<number>;
}

/** In-memory backend for tests and local tooling. Append-only, ordered by occurredAt. */
export class InMemoryLedgerStore implements LedgerStore {
  readonly #evidence: Evidence[] = [];
  readonly #contributions: TeacherContribution[] = [];

  appendEvidence(record: Evidence): Promise<void> {
    if (this.#evidence.some((e) => e.id === record.id)) {
      return Promise.reject(new Error(`evidence ${record.id} already exists (ledger is append-only)`));
    }
    this.#evidence.push(record);
    return Promise.resolve();
  }

  appendTeacherContribution(record: TeacherContribution): Promise<void> {
    if (this.#contributions.some((c) => c.id === record.id)) {
      return Promise.reject(new Error(`contribution ${record.id} already exists`));
    }
    this.#contributions.push(record);
    return Promise.resolve();
  }

  listEvidence(childId: ChildId): Promise<readonly Evidence[]> {
    return Promise.resolve(
      this.#evidence
        .filter((e) => e.childId === childId)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
    );
  }

  listEvidenceForSkill(childId: ChildId, skillId: SkillId): Promise<readonly Evidence[]> {
    return this.listEvidence(childId).then((all) => all.filter((e) => e.skillId === skillId));
  }

  listTeacherContributions(childId: ChildId): Promise<readonly TeacherContribution[]> {
    return Promise.resolve(
      this.#contributions
        .filter((c) => c.childId === childId)
        .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn)),
    );
  }

  countEvidence(childId: ChildId): Promise<number> {
    return Promise.resolve(this.#evidence.filter((e) => e.childId === childId).length);
  }
}
