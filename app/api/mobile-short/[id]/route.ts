import { NextRequest } from 'next/server';
import { getMobileShort, updateMobileShort, deleteMobileShort } from '@/lib/mobileShortsStorage';
import { isMobileShortRunLive, cancelMobileShortRun, reconcileMobileShortOrphan } from '@/lib/mobileShortsRunManager';

export const runtime = 'nodejs';

// GET /api/mobile-short/[id]
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  await reconcileMobileShortOrphan(id);
  const short = await getMobileShort(id);
  if (!short) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ short, live: isMobileShortRunLive(id) });
}

// PATCH /api/mobile-short/[id] — partial update
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const body = await req.json();
  const short = await getMobileShort(id);
  if (!short) return Response.json({ error: 'not found' }, { status: 404 });

  const allowed: (keyof typeof body)[] = ['topic', 'domain', 'level', 'objective', 'additionalContext', 'isHighlightCardNeeded', 'numCards', 'status', 'collectionId', 'publishedUrl', 'cards'];
  const patch: any = {};
  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  const updated = await updateMobileShort(id, patch);
  return Response.json({ short: updated });
}

// DELETE /api/mobile-short/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  cancelMobileShortRun(id);
  const deleted = await deleteMobileShort(id);
  if (!deleted) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ ok: true });
}
