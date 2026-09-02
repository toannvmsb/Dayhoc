import { NextResponse } from 'next/server';
import { dispatchRest, RestError } from '@/lib/server/rest';
import { checkRate, ruleClassFor, sweepRateBuckets } from '@/lib/server/rate-limit';

/**
 * Mobile HTTP API (M9 + pilot hardening). Every DạyZi mobile screen goes
 * through here. Same `createProductionApi` graph the web uses, same
 * authorization — only the transport differs (bearer header vs httpOnly cookie).
 *
 * Adds: request id, per-client rate limiting, a 16MB body cap, structured
 * one-line logs (no learning content, no token), and error mapping that never
 * leaks a stack trace.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024 * 1024;

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0] : '') || req.headers.get('x-real-ip') || 'local';
  // include a short bearer fingerprint so shared-IP clients aren't lumped together
  const bearer = req.headers.get('authorization') ?? '';
  const fp = bearer ? hash8(bearer) : 'anon';
  return `${ip.trim()}#${fp}`;
}

function hash8(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function mapStatus(msg: string): number {
  if (/forbidden|not permitted|workspace|denied|NOT_AUTHORIZED|only the family/i.test(msg)) return 403;
  if (/unauthenticated|invalid or expired|missing bearer/i.test(msg)) return 401;
  if (/not found|unknown|no route/i.test(msg)) return 404;
  if (/already exists|conflict|duplicate/i.test(msg)) return 409;
  return 400;
}

async function handle(req: Request, ctx: { params: { path?: string[] } }): Promise<Response> {
  const reqId = (globalThis.crypto?.randomUUID?.() ?? String(Date.now())).slice(0, 8);
  const segs = ctx.params.path ?? [];
  const url = new URL(req.url);
  const started = Date.now();
  sweepRateBuckets();

  // --- rate limit ---
  const cls = ruleClassFor(req.method, segs);
  const rate = checkRate(clientKey(req), cls);
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại.' },
      { status: 429, headers: { 'retry-after': String(rate.retryAfterSec), 'x-request-id': reqId } },
    );
  }

  // --- body (size-capped) ---
  let body: Record<string, unknown> = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Nội dung quá lớn.' }, { status: 413, headers: { 'x-request-id': reqId } });
    }
    try {
      const text = await req.text();
      if (text.length > MAX_BODY_BYTES) {
        return NextResponse.json({ error: 'Nội dung quá lớn.' }, { status: 413, headers: { 'x-request-id': reqId } });
      }
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
  }

  let status = 200;
  let errCode: string | undefined;
  try {
    const result = await dispatchRest(req.method, segs, url.searchParams, req.headers, body);
    return NextResponse.json(result ?? null, { headers: { 'x-request-id': reqId } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    status = err instanceof RestError ? err.status : mapStatus(msg);
    errCode = err instanceof RestError ? 'REST' : (err as { code?: string }).code ?? 'ERR';
    // client message: the domain message for 4xx (already user-safe Vietnamese),
    // a generic line for 5xx. Never a stack trace.
    const clientMsg = status >= 500 ? 'Máy chủ đang gặp sự cố. Thử lại sau.' : msg;
    return NextResponse.json({ error: clientMsg }, { status, headers: { 'x-request-id': reqId } });
  } finally {
    // structured one-liner — route + status + latency + rule class + err code.
    // NO child name / question / answer / gap / evidence / token.
    const line = {
      reqId,
      method: req.method,
      route: `/${segs.map((s) => (/^[0-9a-f-]{20,}$/i.test(s) ? ':id' : s)).join('/')}`,
      status,
      ms: Date.now() - started,
      rule: cls,
      ...(errCode ? { err: errCode } : {}),
    };
    // eslint-disable-next-line no-console
    console[status >= 500 ? 'error' : 'warn'](`[api] ${JSON.stringify(line)}`);
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
