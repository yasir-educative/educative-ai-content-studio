import { NextRequest, NextResponse } from 'next/server';
import { getAnalysis, saveAnalysis, deleteAnalysis, savedKeys } from '@/lib/analysisStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get('key');
  if (!key) return NextResponse.json({ keys: savedKeys() });
  return NextResponse.json({ analysis: getAnalysis(key) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return NextResponse.json({ analysis: await saveAnalysis(body) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to save' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const key = new URL(req.url).searchParams.get('key') || '';
  await deleteAnalysis(key);
  return NextResponse.json({ ok: true });
}
