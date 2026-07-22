import { NextResponse } from 'next/server';
import { getPromptDetail, savePrompt, resetPrompt, rollbackPrompt } from '@/lib/promptStore';
import '@/lib/promptsRegistry';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const detail = getPromptDetail(params.name);
  if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PUT(req: Request, { params }: { params: { name: string } }) {
  const body = await req.json().catch(() => null);
  const newBody = body?.body;
  if (typeof newBody !== 'string') {
    return NextResponse.json({ error: 'body (string) required' }, { status: 400 });
  }
  try {
    const updated = await savePrompt(params.name, newBody);
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { name: string } }) {
  try {
    await resetPrompt(params.name);
    const detail = getPromptDetail(params.name);
    return NextResponse.json(detail);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

export async function POST(req: Request, { params }: { params: { name: string } }) {
  // POST is used to roll back to a prior version: { version: number }
  const body = await req.json().catch(() => null);
  const version = Number(body?.version);
  if (!Number.isFinite(version)) {
    return NextResponse.json({ error: 'version (number) required' }, { status: 400 });
  }
  try {
    const updated = await rollbackPrompt(params.name, version);
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
