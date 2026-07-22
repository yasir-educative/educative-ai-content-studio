import { NextResponse } from 'next/server';
import { listPersonas, createPersona } from '@/lib/personaStore';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ personas: listPersonas() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = body?.name;
  const text = body?.body;
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name (string) required' }, { status: 400 });
  }
  if (typeof text !== 'string') {
    return NextResponse.json({ error: 'body (string) required' }, { status: 400 });
  }
  try {
    const created = await createPersona(name, text);
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
