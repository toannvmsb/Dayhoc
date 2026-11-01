import { NextResponse } from 'next/server';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

/** Parent downloads a copy of everything DạyZi stores about the child (backlog B3-03). */
export async function GET(_req: Request, { params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  try {
    const bundle = await getApi().exportChildData(parentAuth(), params.childId);
    const day = bundle.exportedAt.slice(0, 10);
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="dayzi-du-lieu-${day}.json"`,
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
}
