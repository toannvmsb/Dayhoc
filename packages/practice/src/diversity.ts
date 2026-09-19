import type { Question } from '@copilot/domain';
import { semanticMetaFor, type SemanticMeta } from '@copilot/reference-library';

/**
 * Semantic anti-repeat (policy v1.0, sheet "Claude Instructions" of the question
 * library): per-child exact-row cooldown 60d, structural (selectionKey) cooldown
 * by risk — CAO 21d / VỪA 10d / THẤP 3d — archetype rotation, and a worksheet
 * diversity gate. Pure & deterministic given (history, seed).
 */
export const EXACT_ROW_COOLDOWN_DAYS = 60;
const DAY_MS = 86_400_000;

export interface ServedRecord {
  readonly questionId: string;
  readonly servedAt: number; // epoch ms
}

export interface DiversityContext {
  /** This child's previously served reference questions (per-child, not per-family). */
  readonly recentServed: readonly ServedRecord[];
  readonly nowMs: number;
  /** Varies the pick between children/days while staying reproducible. */
  readonly seed: string;
  /** Planner-marked deliberate review: cooldowns skipped (caller logs TARGETED_REVIEW). */
  readonly targetedReview?: boolean;
  readonly meta?: (questionId: string) => SemanticMeta | undefined;
}

export interface EligibleResult {
  readonly pool: Question[];
  /** Reasons cooldowns were relaxed — for the mandatory selection log. */
  readonly relaxed: string[];
}

const RELAX_ORDER = ['THẤP', 'VỪA', 'CAO'] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Drop questions still in cooldown; relax THẤP → VỪA → CAO → exact-row only if the pool runs dry. */
export function eligiblePool(pool: readonly Question[], ctx: DiversityContext, minNeeded: number): EligibleResult {
  if (ctx.targetedReview) return { pool: [...pool], relaxed: ['TARGETED_REVIEW'] };
  const metaOf = ctx.meta ?? semanticMetaFor;

  const lastServedById = new Map<string, number>();
  const lastServedByKey = new Map<string, number>();
  for (const r of ctx.recentServed) {
    lastServedById.set(r.questionId, Math.max(lastServedById.get(r.questionId) ?? 0, r.servedAt));
    const key = metaOf(r.questionId)?.selectionKey;
    if (key) lastServedByKey.set(key, Math.max(lastServedByKey.get(key) ?? 0, r.servedAt));
  }

  const passes = (q: Question, relaxedRisks: ReadonlySet<string>): boolean => {
    const exact = lastServedById.get(q.id);
    if (exact !== undefined && ctx.nowMs - exact < EXACT_ROW_COOLDOWN_DAYS * DAY_MS) return false;
    const m = metaOf(q.id);
    if (!m || relaxedRisks.has(m.similarityRisk)) return true;
    const t = lastServedByKey.get(m.selectionKey);
    return t === undefined || ctx.nowMs - t >= m.cooldownDays * DAY_MS;
  };

  const relaxed: string[] = [];
  const risks = new Set<string>();
  let out = pool.filter((q) => passes(q, risks));
  for (const risk of RELAX_ORDER) {
    if (out.length >= minNeeded) break;
    risks.add(risk);
    relaxed.push(`COOLDOWN_RELAXED_${risk}`);
    out = pool.filter((q) => passes(q, risks));
  }
  if (out.length < minNeeded) {
    relaxed.push('EXACT_ROW_RELAXED');
    // least-recently-served first, so any repeat is as old as possible
    out = [...pool].sort((a, b) => (lastServedById.get(a.id) ?? 0) - (lastServedById.get(b.id) ?? 0));
  }
  return { pool: out, relaxed };
}

/**
 * Pick `n` from `candidates`: difficulty preference (`kRank`, lower first) stays
 * primary; then no two with the same templateSignature, at most 2 per archetype,
 * least-recently-used archetypes first, seeded tie-break for variety.
 */
export function pickDiverse(
  candidates: readonly Question[],
  n: number,
  ctx: DiversityContext | undefined,
  kRank: (q: Question) => number,
): Question[] {
  if (n <= 0) return [];
  const byRank = [...candidates].sort((a, b) => kRank(a) - kRank(b));
  if (!ctx) return byRank.slice(0, n);
  const metaOf = ctx.meta ?? semanticMetaFor;

  const recentArch = new Map<string, number>();
  for (const r of ctx.recentServed) {
    if (ctx.nowMs - r.servedAt > 7 * DAY_MS) continue;
    const a = metaOf(r.questionId)?.archetype;
    if (a) recentArch.set(a, (recentArch.get(a) ?? 0) + 1);
  }
  const archUse = (q: Question) => recentArch.get(metaOf(q.id)?.archetype ?? '') ?? 0;

  const ordered = byRank.sort(
    (a, b) => kRank(a) - kRank(b) || archUse(a) - archUse(b) || hash(ctx.seed + a.id) - hash(ctx.seed + b.id),
  );

  const chosen: Question[] = [];
  const sigs = new Set<string>();
  const archCount = new Map<string, number>();
  for (const pass of [1, 2, 3] as const) {
    for (const q of ordered) {
      if (chosen.length >= n) return chosen;
      if (chosen.includes(q)) continue;
      const m = metaOf(q.id);
      const arch = m?.archetype ?? '';
      if (pass <= 2 && m && sigs.has(m.templateSignature)) continue;
      if (pass === 1 && arch && (archCount.get(arch) ?? 0) >= 2) continue;
      chosen.push(q);
      if (m) sigs.add(m.templateSignature);
      archCount.set(arch, (archCount.get(arch) ?? 0) + 1);
    }
  }
  return chosen;
}
