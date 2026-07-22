import { NextRequest, NextResponse } from 'next/server';
import { cancelRun, isLive } from '@/lib/runManager';
import { getBlog, updateBlog } from '@/lib/storage';

export const runtime = 'nodejs';

// POST /api/blog/{id}/cancel — stops the in-flight pipeline. If the run isn't live (e.g. server
// restarted mid-run leaving status='running' on disk), we just mark it cancelled directly.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  if (cancelRun(id)) {
    return NextResponse.json({ ok: true, live: true });
  }
  if (!isLive(id)) {
    const rec = await getBlog(id);
    if (rec && rec.status === 'running') {
      await updateBlog(id, { status: 'cancelled', errorMessage: 'Cancelled by user' });
      return NextResponse.json({ ok: true, live: false });
    }
  }
  return NextResponse.json({ ok: false, error: 'run not found or already finished' }, { status: 404 });
}
