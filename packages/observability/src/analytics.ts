/**
 * Privacy-safe product analytics (M49).
 *
 * DạyZi analytics may record WHAT KIND of thing happened and coarse counts —
 * never WHO or the learning content. An event carries:
 *  - a pseudonymous actor id (opaque hash, not a user/child id, not an email),
 *  - a category + action string from a fixed vocabulary,
 *  - numeric / enum metadata only.
 *
 * It must NEVER contain: a child's or parent's name, a school or class name,
 * a question or answer, gap text, evidence text, an email, or a raw id.
 * `sanitizeEvent` drops anything that looks like those and throws in dev if a
 * caller tries to smuggle free text.
 */

export const ANALYTICS_CATEGORIES = [
  'auth',
  'child',
  'practice',
  'upload',
  'exam',
  'relationship',
  'teaching_copilot',
  'plan',
  'subscription',
  'navigation',
] as const;
export type AnalyticsCategory = (typeof ANALYTICS_CATEGORIES)[number];

export interface AnalyticsEvent {
  readonly category: AnalyticsCategory;
  /** snake_case verb, e.g. 'practice_submitted', 'upload_confirmed'. */
  readonly action: string;
  /** Opaque pseudonymous id — a hash, never a real id/email/name. */
  readonly actorRef: string;
  /** Numeric / boolean / short enum values ONLY. No free text, no ids. */
  readonly metadata?: Record<string, number | boolean | string>;
  readonly occurredAt?: string;
}

const FORBIDDEN_METADATA_KEYS = [
  'name',
  'displayname',
  'email',
  'phone',
  'school',
  'class',
  'childid',
  'child_id',
  'userid',
  'user_id',
  'question',
  'prompt',
  'answer',
  'gap',
  'rationale',
  'evidence',
  'note',
  'text',
  'skillname',
];

/** Values longer than this in metadata are treated as free text and rejected. */
const MAX_METADATA_STRING = 32;

export class AnalyticsPrivacyError extends Error {
  constructor(reason: string) {
    super(`analytics event rejected: ${reason}`);
    this.name = 'AnalyticsPrivacyError';
  }
}

/**
 * Return a privacy-scrubbed copy of the event, or throw `AnalyticsPrivacyError`
 * in non-production. In production it drops the offending keys and keeps going
 * (analytics is best-effort, never a request blocker).
 */
export function sanitizeEvent(
  ev: AnalyticsEvent,
  opts: { strict?: boolean } = {},
): AnalyticsEvent {
  const strict = opts.strict ?? process.env.NODE_ENV !== 'production';
  const problems: string[] = [];

  if (!/^[a-f0-9]{8,}$/i.test(ev.actorRef) && !ev.actorRef.startsWith('anon_')) {
    problems.push('actorRef must be an opaque hash or anon_* token, not a raw id');
  }

  const clean: Record<string, number | boolean | string> = {};
  for (const [k, v] of Object.entries(ev.metadata ?? {})) {
    const lk = k.toLowerCase().replace(/[^a-z_]/g, '');
    if (FORBIDDEN_METADATA_KEYS.some((f) => lk.includes(f))) {
      problems.push(`metadata key "${k}" is not allowed`);
      continue;
    }
    if (typeof v === 'string' && (v.length > MAX_METADATA_STRING || /\s{2,}|[.!?]\s/.test(v))) {
      problems.push(`metadata "${k}" looks like free text`);
      continue;
    }
    clean[k] = v;
  }

  if (problems.length > 0 && strict) throw new AnalyticsPrivacyError(problems.join('; '));

  return {
    category: ev.category,
    action: ev.action,
    actorRef: ev.actorRef,
    metadata: clean,
    occurredAt: ev.occurredAt ?? new Date().toISOString(),
  };
}

export interface AnalyticsAdapter {
  readonly name: string;
  track(ev: AnalyticsEvent): void;
}

/** The default — records nothing. */
export class NoopAnalyticsAdapter implements AnalyticsAdapter {
  readonly name = 'noop';
  track(): void {
    /* intentionally nothing */
  }
}

/** Dev adapter — logs the SANITIZED event to the console. */
export class ConsoleAnalyticsAdapter implements AnalyticsAdapter {
  readonly name = 'console';
  track(ev: AnalyticsEvent): void {
    try {
      console.warn('[analytics]', JSON.stringify(sanitizeEvent(ev, { strict: false })));
    } catch {
      /* never throw from analytics */
    }
  }
}

/** Wrap any adapter so it can never throw and always sanitizes first. */
export function safeAnalytics(inner: AnalyticsAdapter): AnalyticsAdapter {
  return {
    name: `safe(${inner.name})`,
    track(ev) {
      try {
        inner.track(sanitizeEvent(ev, { strict: false }));
      } catch {
        /* analytics is best-effort */
      }
    },
  };
}
