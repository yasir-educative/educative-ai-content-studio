import { NextRequest } from 'next/server';
import { getChannel, saveChannel, deleteChannel, redactChannel } from '@/lib/channelStore';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const c = getChannel(params.id);
  if (!c) return Response.json({ error: 'Channel not found' }, { status: 404 });
  return Response.json({ channel: redactChannel(c) });
}

// PUT /api/channels/{id} — secret fields left at the mask keep their stored value.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { name, config } = await req.json();
    const saved = saveChannel(params.id, { name, config });
    return Response.json({ channel: redactChannel(saved) });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteChannel(params.id);
    return Response.json({ ok: true });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 400 });
  }
}
