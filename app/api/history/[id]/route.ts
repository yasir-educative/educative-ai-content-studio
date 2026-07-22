import { NextRequest } from 'next/server';
import { getBlog, deleteBlog } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const blog = await getBlog(params.id);
  if (!blog) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ blog });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ok = await deleteBlog(params.id);
  if (!ok) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ ok: true });
}
