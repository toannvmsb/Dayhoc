import { NextResponse } from 'next/server';
import { dispatchRest, RestError } from '@/lib/server/rest';

/**
 * Mobile HTTP API (M9). Every DạyZi mobile screen goes through here. Same
 * `createProductionApi` graph the web uses, same authorization — only the
 * transport differs (bearer header instead of httpOnly cookie).
 */
export const dynamic = 'force-dynamic';

async function handle(req: Request, ctx: { params: { path?: string[] } }): Promise<Response> {
  const segs = ctx.params.path ?? [];
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  try {
    const result = await dispatchRest(req.method, segs, url.searchParams, req.headers, body);
    return NextResponse.json(result ?? null);
  } catch (err) {
    if (err instanceof RestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    const status = /forbidden|not permitted|workspace|denied|NOT_AUTHORIZED/i.test(msg)
      ? 403
      : /not found|unknown/i.test(msg)
        ? 404
        : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
