import { NextRequest } from 'next/server';
import { listChannels, createChannel, redactChannel, listTrashedChannels, restoreChannel } from '@/lib/channelStore';

export const runtime = 'nodejs';

// GET /api/channels — every configured destination, secrets masked, plus anything in the trash.
export async function GET() {
  try {
    return Response.json({
      channels: listChannels().map(redactChannel),
      trashed: listTrashedChannels(),
    });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

// POST /api/channels — add a destination, or restore one from the trash.
export async function POST(req: NextRequest) {
  try {
    const { name, type, config, restore } = await req.json();
    if (restore) {
      return Response.json({ channel: redactChannel(restoreChannel(restore)) });
    }
    const created = createChannel({ name, type, config: config || {} });
    return Response.json({ channel: redactChannel(created) });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 400 });
  }
}
