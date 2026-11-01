import { NextResponse } from 'next/server';
import { getApi } from '@/lib/server/api';
import { rejectUnlessCron } from '@/lib/server/cron-auth';

/**
 * Daily maintenance trigger (backlog B3-04). Called by the Netlify scheduled function
 * (`netlify/functions/daily-cron.mjs`) with `Authorization: Bearer $CRON_SECRET`.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = rejectUnlessCron(req);
  if (denied) return denied;
  return NextResponse.json(await getApi().runScheduledJobs());
}
