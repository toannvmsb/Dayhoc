import { createHash } from 'node:crypto';
import type { DataCategory, ProviderCompliance } from './provider.js';

/**
 * Data minimization before any external-provider call (Privacy Architecture §5).
 *
 * - strips PII fields the task does not need (name, address, school, phone, …)
 * - replaces `childId` with an opaque, stable `childRef` hash
 * - refuses if the payload's declared categories exceed the provider's allowance
 * - refuses any provider whose `trainingAllowed` is true (child data must never
 *   be usable for model training)
 */
export class DataMinimizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataMinimizationError';
  }
}

/** Fields never sent to an external provider unless a task explicitly opts in. */
const PII_KEYS = new Set([
  'displayName',
  'name',
  'fullName',
  'childName',
  'parentName',
  'address',
  'phone',
  'email',
  'schoolName',
  'className',
  'teacherName',
]);

export interface MinimizeInput<T> {
  readonly payload: T;
  /** Categories of child data this payload actually contains. */
  readonly categories: readonly DataCategory[];
  readonly provider: ProviderCompliance;
  /** Raw child id — replaced with an opaque ref in the output. */
  readonly childId: string;
  /** Task-specific PII allow-list (rare; e.g. name needed for a personalised note). */
  readonly allowPii?: readonly string[];
  /** Salt so the child_ref is not reversible across deployments. */
  readonly refSalt?: string;
}

export interface Minimized<T> {
  readonly payload: T;
  readonly childRef: string;
  readonly strippedKeys: readonly string[];
}

export function minimizeForProvider<T>(input: MinimizeInput<T>): Minimized<T> {
  if (input.provider.trainingAllowed) {
    throw new DataMinimizationError(
      `provider "${input.provider.provider}" has trainingAllowed=true — not permitted for child data`,
    );
  }
  const overflow = input.categories.filter(
    (c) => !input.provider.dataCategoriesAllowed.includes(c),
  );
  if (overflow.length > 0) {
    throw new DataMinimizationError(
      `payload categories [${overflow.join(', ')}] exceed what "${input.provider.provider}" may receive`,
    );
  }

  const childRef = createHash('sha256')
    .update(`${input.refSalt ?? 'copilot'}:${input.childId}`)
    .digest('hex')
    .slice(0, 16);

  const allow = new Set(input.allowPii ?? []);
  const stripped: string[] = [];

  const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if ((k === 'childId' || k === 'child_id') && typeof v === 'string') {
          out.childRef = childRef;
          continue;
        }
        if (PII_KEYS.has(k) && !allow.has(k)) {
          stripped.push(k);
          continue;
        }
        out[k] = scrub(v);
      }
      return out;
    }
    return value;
  };

  return { payload: scrub(input.payload) as T, childRef, strippedKeys: [...new Set(stripped)] };
}
