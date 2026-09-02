import { NextResponse } from 'next/server';
import { pingDb } from '@/lib/server/api';

/**
 * Readiness — can the API serve traffic? Pings Postgres; 503 when the DB is
 * unreachable so a load balancer holds traffic.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await pingDb();
    return NextResponse.json({ status: 'ready', db: 'up' });
  } catch (e) {
    return NextResponse.json(
      { status: 'not_ready', db: 'down', reason: e instanceof Error ? e.message : 'unknown' },
      { status: 503 },
    );
  }
}
