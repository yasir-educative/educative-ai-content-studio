import { NextRequest, NextResponse } from 'next/server';
import { getBlog, updateBlog } from '@/lib/storage';
import { getRun } from '@/lib/runManager';

export const runtime = 'nodejs';

// GET /api/blog/[id] — read the full saved record from disk.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const record = await getBlog(params.id);
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(record);
}

// PATCH /api/blog/[id] — save edited HTML, Markdown, and/or editorBlocks.
// html: innerHTML of contenteditable article (blog/newsletter)
// markdown: raw markdown string (course lessons)
// editorBlocks: updated editor blocks array (e.g. after image replacement)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  try {
    const body = await req.json();
    const { html, markdown, editorBlocks } = body;
    const patch: Record<string, any> = {};
    if (typeof html === 'string') patch.html = html;
    if (typeof markdown === 'string') patch.markdown = markdown;
    if (Array.isArray(editorBlocks)) patch.editorBlocks = editorBlocks;
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: 'html, markdown, or editorBlocks is required' }, { status: 400 });
    }
    const updated = await updateBlog(id, patch);
    if (!updated) {
      return NextResponse.json({ error: 'Blog not found' }, { status: 404 });
    }
    // Patch in-memory run handle if still live so re-attaches get fresh content.
    const handle = getRun(id);
    if (handle) {
      if (patch.html) {
        handle.record.html = patch.html;
        const idx = handle.events.findIndex((e: any) => e?.type === 'final');
        if (idx !== -1) {
          handle.events[idx] = { ...handle.events[idx], payload: { ...handle.events[idx].payload, html: patch.html } };
        }
      }
      if (patch.markdown) {
        handle.record.markdown = patch.markdown;
        const idx = handle.events.findIndex((e: any) => e?.type === 'final');
        if (idx !== -1) {
          handle.events[idx] = { ...handle.events[idx], payload: { ...handle.events[idx].payload, markdown: patch.markdown } };
        }
      }
    }
    return NextResponse.json(patch);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to save' }, { status: 500 });
  }
}
