import { NextRequest, NextResponse } from 'next/server';
import { resumeRun } from '@/lib/runManager';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { gate, value, edited } = await req.json();
  if (!gate) {
    return NextResponse.json({ ok: false, error: 'missing gate' }, { status: 400 });
  }
  const ok = resumeRun(params.id, gate, value, !!edited);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'gate not found or run finished' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
