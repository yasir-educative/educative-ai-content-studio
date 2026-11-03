import { NextRequest, NextResponse } from 'next/server';
import { listStyles, saveStyle, deleteStyle, setDefaultStyle } from '@/lib/imageStyleStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(listStyles());
}

// Create or update. Editing the builtin forks it into a new saved style.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const style = await saveStyle({ id: b.id, name: b.name, body: b.body });
    return NextResponse.json({ style, ...listStyles() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to save style' }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { id, scope } = await req.json();
    await setDefaultStyle(String(id || ''), scope === 'mobile' ? 'mobile' : 'educative');
    return NextResponse.json(listStyles());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to set default' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await deleteStyle(new URL(req.url).searchParams.get('id') || '');
    return NextResponse.json(listStyles());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to delete style' }, { status: 400 });
  }
}
