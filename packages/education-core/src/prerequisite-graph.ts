import type { SkillId } from '@copilot/domain';

/**
 * A directed prerequisite edge: `from` must be mastered before `to`.
 * Edges may cross grade boundaries (G4 → … → G9/HSG). The graph as a whole
 * MUST stay acyclic — a cycle would make readiness/root-gap tracing undefined.
 */
export interface PrerequisiteEdge {
  readonly from: SkillId;
  readonly to: SkillId;
  readonly importance: number; // 0..1
  readonly crossGrade: boolean;
}

export interface CycleReport {
  readonly acyclic: boolean;
  readonly cycle?: readonly SkillId[];
}

/**
 * Detect whether the prerequisite graph is a DAG (deterministic, pure).
 * Returns the first cycle found so data authors can fix it. Used both at runtime
 * guard time and as a Golden Test invariant (Golden Test §4).
 */
export function checkAcyclic(edges: readonly PrerequisiteEdge[]): CycleReport {
  const adjacency = new Map<SkillId, SkillId[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<SkillId, number>();
  const stack: SkillId[] = [];

  const visit = (node: SkillId): readonly SkillId[] | undefined => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
      if (c === WHITE) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return undefined;
  };

  const nodes = new Set<SkillId>();
  for (const edge of edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);
  }
  for (const node of nodes) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      const cycle = visit(node);
      if (cycle) return { acyclic: false, cycle };
    }
  }
  return { acyclic: true };
}
