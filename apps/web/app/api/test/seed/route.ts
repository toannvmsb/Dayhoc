import { NextResponse } from 'next/server';
import { getApi } from '@/lib/server/api';

/**
 * DEV/TEST ONLY seed hook for the M8 golden-journey E2E. Lets a browser test
 * plant append-only evidence for a child so gap-repair (J5) and advanced-child
 * (J6) journeys can be exercised without a bespoke UI for every signal.
 *
 * Hard-disabled unless DZ_DEV_AUTH=1 AND NODE_ENV !== 'production'.
 */
export const dynamic = 'force-dynamic';

function enabled(): boolean {
  return process.env.DZ_DEV_AUTH === '1' && process.env.NODE_ENV !== 'production';
}

export async function POST(req: Request) {
  if (!enabled()) return NextResponse.json({ error: 'disabled' }, { status: 403 });

  const body = (await req.json()) as {
    childId: string;
    evidence: Array<{
      skillId: string;
      correct: boolean;
      daysAgo?: number;
      source?: string;
      tier?: 'A' | 'B' | 'C' | 'D';
      reasoningQuality?: 'weak' | 'adequate' | 'strong';
    }>;
  };
  if (!body?.childId || !Array.isArray(body.evidence)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const api = getApi() as unknown as {
    _services: {
      ledger: { appendEvidence: (r: Record<string, unknown>) => Promise<unknown> };
      learningState: { invalidateDerived: (c: string) => Promise<void> };
    };
  };

  try {
    for (const [i, e] of body.evidence.entries()) {
      const at = new Date(Date.now() - (e.daysAgo ?? 5) * 86_400_000).toISOString();
      await api._services.ledger.appendEvidence({
        id: `ev_seed_${Date.now()}_${i}`,
        childId: body.childId,
        source: e.source ?? 'school_test',
        occurredAt: at,
        recordedAt: new Date().toISOString(),
        skillId: e.skillId,
        result: { correct: e.correct },
        ...(e.reasoningQuality ? { reasoningQuality: e.reasoningQuality } : {}),
        confidenceTier: e.tier ?? 'A',
        provenance: 'assessment',
      });
    }
    await api._services.learningState.invalidateDerived(body.childId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'seed failed' },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, seeded: body.evidence.length });
}
