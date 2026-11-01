import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { makeNotification, type NotificationDeliveryAdapter } from '@copilot/revision';
import { vnDay } from './vn-time.js';

/**
 * Backlog B2-04 — nudge the parent when the child has not practised for 2+ days.
 *
 * The decision is a pure function (`decideReminder`) so it is unit-tested without a database:
 *   - inactive = Vietnam calendar days since the child's last attempt (or, if they never attempted,
 *     since the first worksheet was made for them). A child who was never given anything is not nagged.
 *   - fire from `INACTIVITY_DAYS` (2) onward, at most once per Vietnam day, with a `COOLDOWN_DAYS` gap,
 *     and never more than `MAX_REMINDERS_PER_LAPSE` times since the last activity — a child who has left
 *     for good must not turn into a daily email forever.
 */
export const INACTIVITY_DAYS = 2;
export const COOLDOWN_DAYS = 3;
export const MAX_REMINDERS_PER_LAPSE = 3;

export interface ReminderFacts {
  /** Vietnam day (YYYY-MM-DD) of the newest attempt, or null if none. */
  readonly lastAttemptDay: string | null;
  /** Vietnam day of the first worksheet made for the child, or null if none. */
  readonly firstAssignmentDay: string | null;
  readonly today: string;
  readonly remindersEnabled: boolean;
  /** Vietnam days of reminders already sent since the child's last activity (ascending not required). */
  readonly remindersSinceActivity: readonly string[];
}

export type ReminderDecision =
  | { readonly send: true; readonly inactiveDays: number }
  | {
      readonly send: false;
      readonly reason: 'DISABLED' | 'NEVER_STARTED' | 'ACTIVE_RECENTLY' | 'COOLDOWN' | 'LAPSE_CAP_REACHED';
      readonly inactiveDays: number | null;
    };

function dayDiff(later: string, earlier: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
}

export function inactiveDaysOf(f: Pick<ReminderFacts, 'lastAttemptDay' | 'firstAssignmentDay' | 'today'>): number | null {
  const anchor = f.lastAttemptDay ?? f.firstAssignmentDay;
  return anchor === null ? null : Math.max(0, dayDiff(f.today, anchor));
}

export function decideReminder(f: ReminderFacts): ReminderDecision {
  const inactiveDays = inactiveDaysOf(f);
  if (!f.remindersEnabled) return { send: false, reason: 'DISABLED', inactiveDays };
  if (inactiveDays === null) return { send: false, reason: 'NEVER_STARTED', inactiveDays };
  if (inactiveDays < INACTIVITY_DAYS) return { send: false, reason: 'ACTIVE_RECENTLY', inactiveDays };
  if (f.remindersSinceActivity.length >= MAX_REMINDERS_PER_LAPSE) {
    return { send: false, reason: 'LAPSE_CAP_REACHED', inactiveDays };
  }
  const last = [...f.remindersSinceActivity].sort().at(-1);
  if (last !== undefined && dayDiff(f.today, last) < COOLDOWN_DAYS) {
    return { send: false, reason: 'COOLDOWN', inactiveDays };
  }
  return { send: true, inactiveDays };
}

// ---------------------------------------------------------------------------
// database side
// ---------------------------------------------------------------------------

interface CandidateRow {
  child_id: string;
  display_name: string;
  reminders_enabled: boolean;
  last_attempt_at: Date | null;
  first_assignment_at: Date | null;
}

/** Children that could possibly need a nudge: active profile, something was made for them. */
async function loadCandidates(pool: Pool, childId?: string): Promise<CandidateRow[]> {
  const { rows } = await pool.query<CandidateRow>(
    `SELECT c.id AS child_id, c.display_name, c.reminders_enabled,
            (SELECT max(GREATEST(a.started_at, COALESCE(a.submitted_at, a.started_at)))
               FROM attempts a WHERE a.child_id = c.id) AS last_attempt_at,
            (SELECT min(s.created_at) FROM assignments s WHERE s.child_id = c.id) AS first_assignment_at
       FROM child_profiles c
      WHERE c.deletion_state = 'active'
        AND ($1::uuid IS NULL OR c.id = $1::uuid)
        AND EXISTS (SELECT 1 FROM assignments s WHERE s.child_id = c.id)`,
    [childId ?? null],
  );
  return rows;
}

async function remindersSince(pool: Pool, childId: string, since: Date | null): Promise<string[]> {
  const { rows } = await pool.query<{ vn_day: string }>(
    `SELECT to_char(vn_day, 'YYYY-MM-DD') AS vn_day FROM reminder_log
      WHERE child_id = $1 AND kind = 'INACTIVITY' AND ($2::timestamptz IS NULL OR created_at > $2::timestamptz)`,
    [childId, since],
  );
  return rows.map((r) => r.vn_day);
}

function factsOf(row: CandidateRow, sent: readonly string[], now: Date): ReminderFacts {
  return {
    lastAttemptDay: row.last_attempt_at ? vnDay(row.last_attempt_at) : null,
    firstAssignmentDay: row.first_assignment_at ? vnDay(row.first_assignment_at) : null,
    today: vnDay(now),
    remindersEnabled: row.reminders_enabled,
    remindersSinceActivity: sent,
  };
}

/** Read-only status for the parent's home banner. */
export async function getInactivityStatus(
  pool: Pool,
  childId: string,
  now: Date,
): Promise<{ inactiveDays: number | null; needsNudge: boolean; remindersEnabled: boolean }> {
  const row = (await loadCandidates(pool, childId))[0];
  if (!row) {
    const r = await pool.query<{ reminders_enabled: boolean }>(`SELECT reminders_enabled FROM child_profiles WHERE id = $1`, [childId]);
    return { inactiveDays: null, needsNudge: false, remindersEnabled: r.rows[0]?.reminders_enabled ?? true };
  }
  const inactiveDays = inactiveDaysOf(factsOf(row, [], now));
  return {
    inactiveDays,
    needsNudge: inactiveDays !== null && inactiveDays >= INACTIVITY_DAYS,
    remindersEnabled: row.reminders_enabled,
  };
}

export interface ReminderRunResult {
  readonly considered: number;
  readonly sent: number;
  readonly skipped: Readonly<Record<string, number>>;
  readonly delivered: number;
}

/**
 * Scan every child and send the nudges that are due. Idempotent within a Vietnam day: the
 * (child, kind, day) unique key means a second run (cron retry, double click) sends nothing more.
 * A delivery failure never aborts the run — notifications are best-effort.
 */
export async function runInactivityReminders(
  pool: Pool,
  notifications: NotificationDeliveryAdapter,
  now: Date,
  /** Restrict the run to one child (tests / a "send now" action); the default is everyone. */
  onlyChildId?: string,
): Promise<ReminderRunResult> {
  // No delivery channel configured: do not log a "sent" reminder that nobody received, or the
  // per-lapse cap would be used up before a real channel (email / push) is ever switched on.
  if (notifications.name === 'noop') {
    return { considered: 0, sent: 0, skipped: { NO_DELIVERY_CHANNEL: 1 }, delivered: 0 };
  }
  const skipped: Record<string, number> = {};
  let sent = 0;
  let delivered = 0;
  const candidates = await loadCandidates(pool, onlyChildId);

  for (const row of candidates) {
    const lastActivity = row.last_attempt_at;
    const decision = decideReminder(factsOf(row, await remindersSince(pool, row.child_id, lastActivity), now));
    if (!decision.send) {
      skipped[decision.reason] = (skipped[decision.reason] ?? 0) + 1;
      continue;
    }

    // claim the day first, so a concurrent run cannot double-send
    const claim = await pool.query(
      `INSERT INTO reminder_log (child_id, kind, vn_day, inactive_days)
       VALUES ($1, 'INACTIVITY', $2::date, $3) ON CONFLICT (child_id, kind, vn_day) DO NOTHING RETURNING id`,
      [row.child_id, vnDay(now), decision.inactiveDays],
    );
    if (claim.rowCount === 0) {
      skipped['ALREADY_SENT_TODAY'] = (skipped['ALREADY_SENT_TODAY'] ?? 0) + 1;
      continue;
    }

    const guardians = await pool.query<{ parent_user_id: string }>(
      `SELECT parent_user_id FROM parent_child_relationships
        WHERE child_id = $1 AND status = 'ACTIVE' AND can_manage_child = true`,
      [row.child_id],
    );
    let ok = 0;
    for (const g of guardians.rows) {
      const n = makeNotification(
        'practice_reminder',
        { targetUserId: g.parent_user_id, at: now.toISOString(), newId: randomUUID },
        {
          title: `${row.display_name} chưa luyện tập ${decision.inactiveDays} ngày`,
          body: `Chỉ cần ${row.display_name} làm vài phút hôm nay là giữ được nhịp học. Mở DạyZi để xem bài hôm nay.`,
        },
      );
      try {
        const r = await notifications.send(g.parent_user_id, n);
        if (r.delivered) ok += 1;
      } catch {
        // best-effort
      }
    }
    await pool.query(`UPDATE reminder_log SET recipients = $2, delivered = $3 WHERE child_id = $1 AND kind = 'INACTIVITY' AND vn_day = $4::date`, [
      row.child_id,
      guardians.rowCount ?? 0,
      ok,
      vnDay(now),
    ]);
    sent += 1;
    delivered += ok;
  }
  return { considered: candidates.length, sent, skipped, delivered };
}
