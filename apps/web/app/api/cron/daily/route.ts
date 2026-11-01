import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getApi } from '@/lib/server/api';

/**
 * Daily maintenance trigger (backlog B3-04). Called by the Netlify scheduled function
 * (`netlify/functions/daily-cron.mjs`) with `Authorization: Bearer $CRON_SECRET`.
 *
 * Off unless CRON_SECRET is set to a long random value: with no secret the route answers 404, so
 * a deployment that has not opted in exposes nothing. The comparison is constant-time.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MIN_SECRET_LENGTH = 24;

function authorised(req: Request, secret: string): boolean {
  const given = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1] ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!authorised(req, secret)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await getApi().runScheduledJobs();
  return NextResponse.json(result);
}
