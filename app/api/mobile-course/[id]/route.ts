import { NextRequest } from 'next/server';
import { getMobileCourse, updateMobileCourse, deleteMobileCourse } from '@/lib/mobileCourseStorage';
import { isMobileCourseRunLive, reconcileMobileCourseOrphan } from '@/lib/mobileCourseRunManager';

export const runtime = 'nodejs';

// GET /api/mobile-course/[id]
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  await reconcileMobileCourseOrphan(id);
  const course = await getMobileCourse(id);
  if (!course) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ course, live: isMobileCourseRunLive(id) });
}

// PATCH /api/mobile-course/[id] — update cards for a chapter or top-level fields
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const body = await req.json();
  const course = await getMobileCourse(id);
  if (!course) return Response.json({ error: 'not found' }, { status: 404 });

  // Update a specific chapter's cards
  if (body.chapterId !== undefined && body.cards !== undefined) {
    const chapters = course.chapters.map((ch) =>
      ch.id === body.chapterId ? { ...ch, cards: body.cards } : ch,
    );
    const updated = await updateMobileCourse(id, { chapters });
    return Response.json({ course: updated });
  }

  // Generic patch (title, status, targetCollectionId, etc.)
  const allowed: (keyof typeof body)[] = ['title', 'targetCollectionId', 'status'];
  const patch: any = {};
  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  const updated = await updateMobileCourse(id, patch);
  return Response.json({ course: updated });
}

// DELETE /api/mobile-course/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const deleted = await deleteMobileCourse(id);
  if (!deleted) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ ok: true });
}
