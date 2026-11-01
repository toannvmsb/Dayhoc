import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

const MIN_SECRET_LENGTH = 24;

/**
 * Shared guard for the scheduled-job routes (/api/cron/*). Returns a response to send back when the call must
 * not proceed, or null when it is authorised. With no (or a short) CRON_SECRET the routes answer 404, so a
 * deployment that has not opted in exposes nothing. The comparison is constant-time.
 */
export function rejectUnlessCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const given = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1] ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return null;
}
