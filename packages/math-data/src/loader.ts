import { createHash } from 'node:crypto';
import { asSkillId, type SkillId } from '@copilot/domain';
import { checkAcyclic, type PrerequisiteEdge } from '@copilot/education-core';
import { gradeDatasetSchema, type CurriculumNode, type GradeDataset, type ProblemType, type Skill } from './schema.js';
import grade4 from './data/grade4.json' with { type: 'json' };
import grade7 from './data/grade7.json' with { type: 'json' };

export class MathDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MathDataError';
  }
}

/**
 * Provenance of the loaded knowledge base (doc 14 C3.1 §D). `contentHash` is a
 * deterministic fingerprint of the actual KB content — it changes iff a skill /
 * curriculum node / prerequisite edge / problem type changes, with no manual
 * bump. `datasetRevision` is the human tag from the data files.
 */
export interface KbProvenance {
  readonly datasetRevision: string;
  readonly source: string;
  readonly contentHash: string; // 16 hex chars of sha256 over the normalized datasets
  readonly skillCount: number;
  readonly curriculumNodeCount: number;
  readonly prerequisiteCount: number;
  readonly problemTypeCount: number;
}

/** Validated, indexed, cross-checked knowledge base spanning all loaded grades. */
export interface KnowledgeBase {
  readonly provenance: KbProvenance;
  readonly skills: ReadonlyMap<SkillId, Skill>;
  readonly curriculum: ReadonlyMap<string, CurriculumNode>;
  readonly problemTypes: readonly ProblemType[];
  readonly prerequisites: readonly PrerequisiteEdge[];
  readonly getSkill: (id: string) => Skill;
  readonly getCurriculumNode: (id: string) => CurriculumNode;
  readonly getProblemTypesForSkill: (id: string) => readonly ProblemType[];
  /** Direct prerequisite skills of `id` (one hop). */
  readonly directPrerequisites: (id: string) => readonly SkillId[];
  /** All transitive prerequisites of `id`, nearest first (BFS over the DAG). */
  readonly prerequisiteClosure: (id: string) => readonly SkillId[];
  /** Skills that list `id` as a prerequisite (one hop) — "what does this unlock". */
  readonly dependents: (id: string) => readonly SkillId[];
}

const RAW_DATASETS: readonly unknown[] = [grade4, grade7];

function validateDatasets(raw: readonly unknown[]): GradeDataset[] {
  return raw.map((entry, i) => {
    const parsed = gradeDatasetSchema.safeParse(entry);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
      throw new MathDataError(`math-data dataset #${i} failed schema validation:\n${issues}`);
    }
    return parsed.data;
  });
}

/** Deterministic fingerprint of the KB content (order-independent). */
function computeProvenance(datasets: readonly GradeDataset[]): KbProvenance {
  const sortById = <T extends { id: string }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => a.id.localeCompare(b.id));
  const norm = datasets
    .slice()
    .sort((a, b) => a.gradeContext - b.gradeContext)
    .map((d) => ({
      gradeContext: d.gradeContext,
      curriculum: sortById(d.curriculum),
      skills: sortById(d.skills),
      problemTypes: sortById(d.problemTypes),
      prerequisites: [...d.prerequisites].sort((a, b) => `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`)),
    }));
  const contentHash = createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 16);
  const revisions = datasets.map((d) => d.meta?.datasetRevision).filter((r): r is string => !!r);
  return {
    datasetRevision: revisions.length > 0 ? [...new Set(revisions)].sort().join('+') : 'unversioned',
    source: datasets.find((d) => d.meta?.source)?.meta?.source ?? 'math-dev-core',
    contentHash,
    skillCount: norm.reduce((n, d) => n + d.skills.length, 0),
    curriculumNodeCount: norm.reduce((n, d) => n + d.curriculum.length, 0),
    prerequisiteCount: norm.reduce((n, d) => n + d.prerequisites.length, 0),
    problemTypeCount: norm.reduce((n, d) => n + d.problemTypes.length, 0),
  };
}

function buildKnowledgeBase(datasets: readonly GradeDataset[]): KnowledgeBase {
  const provenance = computeProvenance(datasets);
  const skills = new Map<SkillId, Skill>();
  const curriculum = new Map<string, CurriculumNode>();
  const problemTypes: ProblemType[] = [];
  const prerequisites: PrerequisiteEdge[] = [];

  for (const ds of datasets) {
    for (const node of ds.curriculum) {
      if (curriculum.has(node.id)) throw new MathDataError(`duplicate curriculum node id: ${node.id}`);
      curriculum.set(node.id, node);
    }
    for (const skill of ds.skills) {
      const id = asSkillId(skill.id);
      if (skills.has(id)) throw new MathDataError(`duplicate skill id: ${skill.id}`);
      if (skill.gradeContext !== ds.gradeContext) {
        throw new MathDataError(
          `skill ${skill.id} has gradeContext ${skill.gradeContext} but lives in the grade-${ds.gradeContext} dataset`,
        );
      }
      skills.set(id, skill);
    }
    problemTypes.push(...ds.problemTypes);
  }

  // Prerequisite edges are collected after every skill is known, so cross-grade
  // `from` references (e.g. an M4 skill feeding a G7 skill) resolve correctly.
  for (const ds of datasets) {
    for (const edge of ds.prerequisites) {
      const from = skills.get(asSkillId(edge.from));
      const to = skills.get(asSkillId(edge.to));
      if (!from) throw new MathDataError(`prerequisite edge references unknown skill: ${edge.from}`);
      if (!to) throw new MathDataError(`prerequisite edge references unknown skill: ${edge.to}`);
      const actuallyCrossGrade = from.gradeContext !== to.gradeContext;
      if (actuallyCrossGrade !== edge.crossGrade) {
        throw new MathDataError(
          `prerequisite ${edge.from} -> ${edge.to}: crossGrade=${edge.crossGrade} but grades are ${from.gradeContext} and ${to.gradeContext}`,
        );
      }
      prerequisites.push({
        from: asSkillId(edge.from),
        to: asSkillId(edge.to),
        importance: edge.importance,
        crossGrade: edge.crossGrade,
      });
    }
  }

  // Referential integrity: every skill maps to a real curriculum node.
  for (const skill of skills.values()) {
    if (!curriculum.has(skill.curriculumNodeId)) {
      throw new MathDataError(`skill ${skill.id} maps to missing curriculum node ${skill.curriculumNodeId}`);
    }
  }
  // Every problem type belongs to a real skill.
  for (const pt of problemTypes) {
    if (!skills.has(asSkillId(pt.skillId))) {
      throw new MathDataError(`problem type ${pt.id} references unknown skill ${pt.skillId}`);
    }
  }

  // The prerequisite graph MUST be a DAG (readiness / root-gap tracing depend on it).
  const cycle = checkAcyclic(prerequisites);
  if (!cycle.acyclic) {
    throw new MathDataError(`prerequisite graph contains a cycle: ${cycle.cycle?.join(' -> ')}`);
  }

  const pushInto = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  const incoming = new Map<SkillId, SkillId[]>(); // to -> [from...]
  const outgoing = new Map<SkillId, SkillId[]>(); // from -> [to...]
  for (const edge of prerequisites) {
    pushInto(incoming, edge.to, edge.from);
    pushInto(outgoing, edge.from, edge.to);
  }

  const ptsBySkill = new Map<string, ProblemType[]>();
  for (const pt of problemTypes) {
    pushInto(ptsBySkill, pt.skillId, pt);
  }

  const getSkill = (id: string): Skill => {
    const skill = skills.get(asSkillId(id));
    if (!skill) throw new MathDataError(`unknown skill: ${id}`);
    return skill;
  };
  const getCurriculumNode = (id: string): CurriculumNode => {
    const node = curriculum.get(id);
    if (!node) throw new MathDataError(`unknown curriculum node: ${id}`);
    return node;
  };
  const directPrerequisites = (id: string): readonly SkillId[] => {
    getSkill(id);
    return incoming.get(asSkillId(id)) ?? [];
  };
  const prerequisiteClosure = (id: string): readonly SkillId[] => {
    getSkill(id);
    const seen = new Set<SkillId>();
    const order: SkillId[] = [];
    const queue = [...(incoming.get(asSkillId(id)) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      order.push(next);
      queue.push(...(incoming.get(next) ?? []));
    }
    return order;
  };
  const dependents = (id: string): readonly SkillId[] => {
    getSkill(id);
    return outgoing.get(asSkillId(id)) ?? [];
  };

  return {
    provenance,
    skills,
    curriculum,
    problemTypes,
    prerequisites,
    getSkill,
    getCurriculumNode,
    getProblemTypesForSkill: (id) => ptsBySkill.get(id) ?? [],
    directPrerequisites,
    prerequisiteClosure,
    dependents,
  };
}

let cached: KnowledgeBase | undefined;

/** Load, validate and index the math knowledge base. Cached after first call. */
export function loadKnowledgeBase(): KnowledgeBase {
  cached ??= buildKnowledgeBase(validateDatasets(RAW_DATASETS));
  return cached;
}
