import { z } from 'zod';

/**
 * Boundary validation helper. Every system boundary (HTTP, AI output, storage, jobs)
 * MUST pass untrusted data through a schema before it reaches domain/engine code.
 */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

export function validate<T>(schema: z.ZodType<T>, data: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  const issues = parsed.error.issues.map(
    (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
  );
  return { ok: false, issues };
}

/** Throwing variant for trusted internal call sites (fail fast on programmer error). */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}
