import { NextResponse } from 'next/server';
import { getPersona, savePersona, resetPersona, deletePersona } from '@/lib/personaStore';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const p = getPersona(params.slug);
  if (!p) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(p);
}

export async function PUT(req: Request, { params }: { params: { slug: string } }) {
  const body = await req.json().catch(() => null);
  if (!body || (body.body === undefined && body.name === undefined)) {
    return NextResponse.json({ error: 'body or name required' }, { status: 400 });
  }
  try {
    const updated = await savePersona(params.slug, { body: body.body, name: body.name });
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

// Reset built-in personas (PATCH = partial action: revert to default body).
export async function PATCH(_req: Request, { params }: { params: { slug: string } }) {
  try {
    const reset = await resetPersona(params.slug);
    return NextResponse.json(reset);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  try {
    await deletePersona(params.slug);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
