import { NextRequest } from 'next/server';
import { analyseChapter, fetchWebChapterContent, type WebSelection } from '@/lib/mobileCourseAugment';
import { getMobileCourse } from '@/lib/mobileCourseStorage';

export const runtime = 'nodejs';
export const maxDuration = 600;

/**
 * Plan the update for one chapter. Reads only — nothing is written anywhere.
 *
 * One chapter per request on purpose: a 500-card course does not fit in one
 * prompt, and the page can show progress as each chapter comes back.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const course = await getMobileCourse(params.id);
  if (!course) return Response.json({ error: 'Course not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const mobileIndex = Number(body.mobileIndex ?? 0);
  if (!course.chapters[mobileIndex]) {
    return Response.json({ error: `There is no chapter ${mobileIndex}` }, { status: 400 });
  }

  const sourceCollectionId = String(body.sourceCollectionId || '').trim();
  // Chapters, or named lessons within them: the two courses do not always
  // pair one chapter to one chapter.
  const selection: WebSelection[] = (Array.isArray(body.selection) ? body.selection : [])
    .map((s: any) => ({
      chapterIndex: Number(s?.chapterIndex),
      pageIds: Array.isArray(s?.pageIds) ? s.pageIds.map(String) : [],
    }))
    .filter((s: WebSelection) => Number.isInteger(s.chapterIndex) && s.chapterIndex >= 0);
  const authorId = course.authorId || process.env.EDUCATIVE_AUTHOR_ID || '';

  try {
    let web;
    if (sourceCollectionId && selection.length) {
      const chapters = await fetchWebChapterContent(authorId, sourceCollectionId, selection);
      if (chapters.length) {
        web = { courseTitle: String(body.webCourseTitle || `Collection ${sourceCollectionId}`), chapters };
      }
    }
    const plan = await analyseChapter(course, {
      mobileIndex,
      instruction: String(body.instruction || '').slice(0, 4000),
      intent: body.intent === 'new-chapter' || body.intent === 'refresh' ? body.intent : 'gaps',
      web,
    });
    return Response.json({ ok: true, plan });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Analysis failed' }, { status: 502 });
  }
}
