import { NextRequest, NextResponse } from 'next/server';
import {
  listStyles, saveStyle, deleteStyle, setDefaultStyle,
  saveStyleReference, clearStyleReference, type StyleScope,
} from '@/lib/imageStyleStore';

const SCOPES: StyleScope[] = ['educative', 'blog', 'mobile', 'course'];
const asScope = (x: unknown): StyleScope =>
  SCOPES.includes(x as StyleScope) ? (x as StyleScope) : 'educative';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(listStyles());
}

// Create or update a style (JSON), or save a style's reference picture
// (multipart, with the style id alongside the file).
export async function POST(req: NextRequest) {
  try {
    if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
      const form = await req.formData();
      const id = String(form.get('id') || '');
      const f = form.get('image');
      if (!id) return NextResponse.json({ error: 'A style is required' }, { status: 400 });
      if (!f || typeof f !== 'object' || !('arrayBuffer' in f)) {
        return NextResponse.json({ error: 'An image file is required' }, { status: 400 });
      }
      const file = f as File;
      if (!file.type.startsWith('image/')) {
        return NextResponse.json({ error: 'That file is not an image' }, { status: 400 });
      }
      const ext = (file.name.split('.').pop() || file.type.split('/')[1] || 'png').toLowerCase();
      await saveStyleReference(id, Buffer.from(await file.arrayBuffer()), ext);
      return NextResponse.json(listStyles());
    }
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
    await setDefaultStyle(String(id || ''), asScope(scope));
    return NextResponse.json(listStyles());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to set default' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const q = new URL(req.url).searchParams;
    const id = q.get('id') || '';
    // ?reference=1 removes only the picture and leaves the style itself.
    if (q.get('reference')) await clearStyleReference(id);
    else await deleteStyle(id);
    return NextResponse.json(listStyles());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to delete style' }, { status: 400 });
  }
}
