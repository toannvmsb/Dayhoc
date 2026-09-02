import { NextResponse } from 'next/server';

/** Liveness — the process is up. No dependencies touched. */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok', service: 'dayzi-api', ts: new Date().toISOString() });
}
