import { NextRequest, NextResponse } from 'next/server';
import { getReference, saveReference, clearReference } from '@/lib/referenceImageStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ reference: getReference() });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const f = form.get('image');
    if (!f || typeof f !== 'object' || !('arrayBuffer' in f)) {
      return NextResponse.json({ error: 'An image file is required' }, { status: 400 });
    }
    const file = f as File;
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'That file is not an image' }, { status: 400 });
    }
    const ext = (file.name.split('.').pop() || file.type.split('/')[1] || 'png').toLowerCase();
    const ref = await saveReference(Buffer.from(await file.arrayBuffer()), ext);
    return NextResponse.json({ reference: ref });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to save reference' }, { status: 400 });
  }
}

export async function DELETE() {
  await clearReference();
  return NextResponse.json({ reference: null });
}
