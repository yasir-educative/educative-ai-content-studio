import { NextRequest, NextResponse } from 'next/server';
import { listVerticals, addVertical, removeVertical, isBuiltin } from '@/lib/verticalStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ verticals: listVerticals() });
}

export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json();
    const verticals = await addVertical(String(name || ''));
    return NextResponse.json({ verticals });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to add vertical' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const name = new URL(req.url).searchParams.get('name') || '';
    if (isBuiltin(name)) {
      return NextResponse.json({ error: 'built-in verticals cannot be removed' }, { status: 400 });
    }
    const verticals = await removeVertical(name);
    return NextResponse.json({ verticals });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to remove vertical' }, { status: 400 });
  }
}
