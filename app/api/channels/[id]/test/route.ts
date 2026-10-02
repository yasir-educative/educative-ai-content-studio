import { NextRequest } from 'next/server';
import { testChannel } from '@/lib/publishers';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/channels/{id}/test — verify stored credentials against the live service.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await testChannel(params.id);
    return Response.json(result);
  } catch (err: any) {
    return Response.json({ ok: false, error: err?.message || String(err) }, { status: 400 });
  }
}
