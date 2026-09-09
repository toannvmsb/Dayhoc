import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/**
 * SMALL FAMILY PILOT (doc 70) — pilot cohort metadata, guardian consent gate,
 * a lightweight parent-feedback ledger, a pseudonymous product-activity event
 * log, and an event-triggered QA sampler for real families. Reuses
 * `internal_live_cohort` for LIVE eligibility (no duplicated authz).
 */

export const PILOT_VERSION = 'pilot.v1';
const refOf = (id: string): string => createHash('sha256').update(id).digest('hex').slice(0, 16);
export const pilotChildRef = refOf;
export const pilotFamilyRef = refOf;

// ---------------------------------------------------------------------------
// guardian consent for pilot LIVE content (doc 70 §4) — uses `consent_records`
// ---------------------------------------------------------------------------

export const PILOT_CONSENT = {
  purpose: 'ai_generated_learning_content_pilot',
  processor: 'openai',
  policyVersion: 'pilot-2026-09',
  consentTextVersion: 'pilot-consent-2026-09',
  dataCategories: ['learning_evidence', 'practice_attempts', 'ai_generated_content', 'short_retention_qa_sample'] as const,
} as const;

export async function recordPilotConsent(
  pool: Pool,
  input: { childId: string; grantedByUserId: string; method?: string; crossBorder?: boolean; destinationRegion?: string },
): Promise<{ consentId: string }> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO consent_records
       (id, child_id, granted_by, relationship, data_categories, purpose, processor,
        cross_border, destination_region, policy_version, consent_text_version, method, accepted_at)
     VALUES ($1,$2,$3,'parent',$4::jsonb,$5,$6,$7,$8,$9,$10,$11, now())`,
    [
      id, input.childId, input.grantedByUserId, JSON.stringify(PILOT_CONSENT.dataCategories),
      PILOT_CONSENT.purpose, PILOT_CONSENT.processor,
      input.crossBorder ?? true, input.destinationRegion ?? 'us',
      PILOT_CONSENT.policyVersion, PILOT_CONSENT.consentTextVersion, input.method ?? 'pilot_onboarding_screen',
    ],
  );
  return { consentId: id };
}

/**
 * True iff the MOST RECENT pilot consent event for this child is a grant.
 * `consent_records` is an append-only ledger (P-05) — a withdrawal is a new row
 * with `withdrawn_at` set, never an UPDATE — so "active" = latest row wins.
 */
export async function hasPilotConsent(pool: Pool, childId: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ withdrawn_at: string | null }>(
      `SELECT withdrawn_at FROM consent_records
        WHERE child_id = $1 AND purpose = $2 AND processor = $3
        ORDER BY accepted_at DESC, id DESC
        LIMIT 1`,
      [childId, PILOT_CONSENT.purpose, PILOT_CONSENT.processor],
    );
    return rows.length > 0 && rows[0]!.withdrawn_at === null;
  } catch {
    return false;
  }
}

/** Append a withdrawal event to the consent ledger. Returns 1 if consent was active. */
export async function withdrawPilotConsent(pool: Pool, childId: string, withdrawnByUserId?: string): Promise<number> {
  if (!(await hasPilotConsent(pool, childId))) return 0;
  const grantedBy =
    withdrawnByUserId ??
    (
      await pool.query<{ granted_by: string }>(
        `SELECT granted_by FROM consent_records
          WHERE child_id = $1 AND purpose = $2 AND processor = $3
          ORDER BY accepted_at DESC, id DESC LIMIT 1`,
        [childId, PILOT_CONSENT.purpose, PILOT_CONSENT.processor],
      )
    ).rows[0]?.granted_by;
  await pool.query(
    `INSERT INTO consent_records
       (id, child_id, granted_by, relationship, data_categories, purpose, processor,
        cross_border, destination_region, policy_version, consent_text_version, method,
        accepted_at, withdrawn_at)
     VALUES ($1,$2,$3,'parent',$4::jsonb,$5,$6, true, 'us', $7,$8,'pilot_withdrawal', now(), now())`,
    [
      randomUUID(), childId, grantedBy, JSON.stringify(PILOT_CONSENT.dataCategories),
      PILOT_CONSENT.purpose, PILOT_CONSENT.processor, PILOT_CONSENT.policyVersion, PILOT_CONSENT.consentTextVersion,
    ],
  );
  return 1;
}

// ---------------------------------------------------------------------------
// pilot cohort helpers (on top of internal_live_cohort)
// ---------------------------------------------------------------------------

export interface PilotFamily {
  readonly familyRef: string;
  readonly kind: string;
  readonly consentRequired: boolean;
  readonly note: string | null;
  readonly addedAt: string;
}

export async function addPilotFamily(
  pool: Pool,
  familyRef: string,
  opts: { note?: string; actorRef: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO internal_live_cohort (family_ref, wave, kind, consent_required, note, added_by, added_at)
     VALUES ($1, 2, 'pilot', true, $2, $3, now())
     ON CONFLICT (family_ref) DO UPDATE SET removed_at = NULL, wave = 2, kind = 'pilot', consent_required = true, note = EXCLUDED.note`,
    [familyRef, opts.note ?? null, opts.actorRef],
  );
}

export async function listPilotFamilies(pool: Pool): Promise<readonly PilotFamily[]> {
  const { rows } = await pool.query<{ family_ref: string; kind: string; consent_required: boolean; note: string | null; added_at: string }>(
    `SELECT family_ref, kind, consent_required, note, added_at FROM internal_live_cohort
      WHERE removed_at IS NULL AND kind = 'pilot' ORDER BY added_at`,
  );
  return rows.map((r) => ({ familyRef: r.family_ref, kind: r.kind, consentRequired: r.consent_required, note: r.note, addedAt: r.added_at }));
}

/** does the cohort row for this family require guardian consent before serving? */
export async function familyRequiresConsent(pool: Pool, familyRef: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ consent_required: boolean }>(
      `SELECT consent_required FROM internal_live_cohort WHERE family_ref = $1 AND removed_at IS NULL`,
      [familyRef],
    );
    return rows[0]?.consent_required ?? false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// parent feedback (doc 70 §5) — append-only; NEVER auto-applied to mastery
// ---------------------------------------------------------------------------

export const FEEDBACK_VERDICTS = [
  'SUITABLE', 'TOO_EASY', 'TOO_HARD', 'WRONG_CURRENT_TOPIC', 'ALREADY_MASTERED', 'CONTENT_QUALITY_ISSUE', 'OTHER',
] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];

/** A soft, non-authoritative hypothesis for a reviewer to validate later. */
function hypothesisFor(v: FeedbackVerdict): string | null {
  switch (v) {
    case 'TOO_EASY': return 'content may be below the child\'s level — check K/T targets vs demonstrated mastery';
    case 'TOO_HARD': return 'content may be above the child\'s level — check K/T targets + prerequisite readiness';
    case 'WRONG_CURRENT_TOPIC': return 'resolved current lesson may be wrong — check enrollment / lesson confirmation / clock';
    case 'ALREADY_MASTERED': return 'a target skill may already be mastered — candidate for a frontier / next-skill shift';
    case 'CONTENT_QUALITY_ISSUE': return 'a generated item may have a quality defect — route to QA review';
    default: return null;
  }
}

export async function recordParentFeedback(
  pool: Pool,
  input: {
    childRef: string;
    familyRef?: string | null;
    assignmentId?: string | null;
    generationSpecId?: string | null;
    verdict: FeedbackVerdict;
    note?: string | null;
  },
): Promise<{ feedbackId: string; hypothesis: string | null }> {
  const id = randomUUID();
  const hypothesis = hypothesisFor(input.verdict);
  await pool.query(
    `INSERT INTO parent_feedback (id, child_ref, family_ref, assignment_id, generation_spec_id, verdict, note, hypothesis, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
    [id, input.childRef, input.familyRef ?? null, input.assignmentId ?? null, input.generationSpecId ?? null, input.verdict, input.note ?? null, hypothesis],
  );
  return { feedbackId: id, hypothesis };
}

export async function feedbackRollup(pool: Pool, sinceIso?: string): Promise<{ total: number; byVerdict: Record<string, number>; hypotheses: number }> {
  const since = sinceIso ?? '1970-01-01T00:00:00Z';
  const { rows } = await pool.query<{ verdict: string; n: number; hyp: number }>(
    `SELECT verdict, count(*)::int n, count(hypothesis)::int hyp FROM parent_feedback WHERE created_at >= $1 GROUP BY verdict`,
    [since],
  );
  const byVerdict: Record<string, number> = {};
  let total = 0;
  let hypotheses = 0;
  for (const r of rows) { byVerdict[r.verdict] = r.n; total += r.n; hypotheses += r.hyp; }
  return { total, byVerdict, hypotheses };
}

// ---------------------------------------------------------------------------
// pseudonymous product-activity events (doc 70 §6)
// ---------------------------------------------------------------------------

export type PilotEvent =
  | 'profile_created' | 'today_viewed' | 'first_worksheet_generated' | 'worksheet_open'
  | 'practice_started' | 'practice_completed' | 'plan_accepted' | 'plan_edited' | 'plan_skipped'
  | 'feedback_submitted';

export async function recordPilotActivity(
  pool: Pool,
  input: { familyRef: string; childRef?: string | null; actor: 'PARENT' | 'STUDENT' | 'SYSTEM'; event: PilotEvent; meta?: Record<string, unknown> },
): Promise<void> {
  await pool.query(
    `INSERT INTO pilot_activity (id, family_ref, child_ref, actor, event, meta, at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb, now())`,
    [randomUUID(), input.familyRef, input.childRef ?? null, input.actor, input.event, JSON.stringify(input.meta ?? {})],
  ).catch(() => undefined); // best-effort telemetry — never blocks the product
}

// QA sampling for pilot families lives in `internal-live-serving.ts`
// (`shouldSampleQa`) — event-triggered on degraded paths, else `PILOT_QA_SAMPLE_RATE`.

// ---------------------------------------------------------------------------
// child-deletion purge (call inside the deletion workflow)
// ---------------------------------------------------------------------------

export async function purgePilotForChild(client: PoolClient, childRef: string): Promise<number> {
  const a = await client.query(`DELETE FROM parent_feedback WHERE child_ref = $1`, [childRef]);
  const b = await client.query(`DELETE FROM pilot_activity WHERE child_ref = $1`, [childRef]);
  return (a.rowCount ?? 0) + (b.rowCount ?? 0);
}
