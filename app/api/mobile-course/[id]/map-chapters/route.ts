import { NextRequest } from 'next/server';
import { fetchWebOutline, mapChapters } from '@/lib/mobileCourseAugment';
import { getMobileCourse, updateMobileCourse } from '@/lib/mobileCourseStorage';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Pair the mobile chapters with the web course's chapters.
 *
 * Titles only, so this is one read of the collection and one model call —
 * cheap enough to run before every analysis, and the author can correct the
 * pairing before anything is read in full.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const course = await getMobileCourse(params.id);
  if (!course) return Response.json({ error: 'Course not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const sourceCollectionId = String(body.sourceCollectionId || course.collectionId || '').trim();
  if (!/^\d+$/.test(sourceCollectionId)) {
    return Response.json({ error: 'A numeric web collection ID is required' }, { status: 400 });
  }
  const authorId = course.authorId || process.env.EDUCATIVE_AUTHOR_ID || '';
  const mobileIndexes: number[] = Array.isArray(body.mobileIndexes) ? body.mobileIndexes.map(Number) : [];

  try {
    const web = await fetchWebOutline(authorId, sourceCollectionId);
    // Picking chapters to generate needs the outline, not the pairing, and the
    // pairing is a model call — skip it when only the list is wanted.
    const matches = body.outlineOnly ? [] : await mapChapters(course, web, mobileIndexes);
    // An imported course does not know where it came from. Remember it once the
    // read succeeds, so the author types the ID only the first time.
    if (course.collectionId !== sourceCollectionId) {
      await updateMobileCourse(params.id, { collectionId: sourceCollectionId });
    }
    return Response.json({
      ok: true,
      sourceCollectionId,
      webTitle: web.title,
      // Lessons travel with the outline so the author can pick them without a second read.
      webChapters: web.chapters,
      matches,
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Could not read the web course' }, { status: 502 });
  }
}
