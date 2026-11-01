import { NextResponse } from 'next/server';
import { getApi } from '@/lib/server/api';
import { rejectUnlessCron } from '@/lib/server/cron-auth';

/**
 * Safety auto-stop (doc 69 §4), every 10 minutes from `netlify/functions/safety-cron.mjs`. Any CRITICAL signal in the
 * recent LIVE window flips the kill switch so no further paid AI generation starts. Harmless while AI is off.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  const denied = rejectUnlessCron(req);
  if (denied) return denied;
  return NextResponse.json(await getApi().runSafetyAutoStop());
}
