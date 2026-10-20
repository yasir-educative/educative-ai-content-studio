import { NextRequest, NextResponse } from 'next/server';
import { getImageStyle, saveImageStyle, resetImageStyle } from '@/lib/imageStyleStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getImageStyle());
}

export async function PUT(req: NextRequest) {
  try {
    const { style } = await req.json();
    return NextResponse.json(await saveImageStyle(style));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to save style' }, { status: 400 });
  }
}

export async function DELETE() {
  return NextResponse.json(await resetImageStyle());
}
