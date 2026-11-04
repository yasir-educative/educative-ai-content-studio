import { NextRequest } from 'next/server';
import { getMobileCourse, saveMobileCourse, type MobileChapter } from '@/lib/mobileCourseStorage';
import { processChapter } from '@/lib/mobileCoursePipeline';
import { fetchWebOutline } from '@/lib/mobileCourseAugment';
import { fetchLessonContent } from '@/lib/courseEducative';

export const runtime = 'nodejs';
export const maxDuration = 600;

/**
 * Build a mobile chapter from a web chapter that has no mobile counterpart.
 *
 * An imported course only covers the chapters someone made cards for; the web
 * course moves on without it. This reads one web chapter and runs it through
 * the same pipeline a generated course uses — the planner, the type decision,
 * the cards generator and the gate — so a chapter added here is the same shape
 * as one generated in the first place. Nothing is published.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const course = await getMobileCourse(params.id);
  if (!course) return new Response('not found', { status: 404 });

  const body = await req.json().catch(() => ({}));
  const sourceCollectionId = String(body.sourceCollectionId || course.collectionId || '').trim();
  const chapterIndex = Number(body.chapterIndex);
  // Empty means the whole web chapter; a list narrows it to those lessons.
  const pageIds: string[] = Array.isArray(body.pageIds) ? body.pageIds.map(String) : [];
  // Where to put it. Given explicitly by "Add chapter after"; otherwise worked
  // out from the web order so a chapter lands where it belongs, not at the end.
  const insertAt = Number.isInteger(body.insertAt) ? Number(body.insertAt) : -1;
  // Which mobile chapter each web chapter corresponds to, as
  // [webChapterIndex, mobileChapterIndex]. Lets a missing chapter be placed
  // after the one that precedes it on the web and before the one that follows.
  const pairs: Array<[number, number]> = Array.isArray(body.pairs)
    ? body.pairs.map((p: any) => [Number(p?.[0]), Number(p?.[1])] as [number, number])
      .filter(([w, m]: [number, number]) => Number.isInteger(w) && Number.isInteger(m))
    : [];

  if (!/^\d+$/.test(sourceCollectionId)) {
    return Response.json({ error: 'A numeric web collection ID is required' }, { status: 400 });
  }
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0) {
    return Response.json({ error: 'A web chapter index is required' }, { status: 400 });
  }

  const authorId = course.authorId || process.env.EDUCATIVE_AUTHOR_ID || '';
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const send = (data: object) => writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  (async () => {
    // A generated id, because this chapter has no mobile counterpart yet. The
    // web chapter's own id is kept so a later read knows where it came from.
    const chapterId = `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      send({ type: 'stage', name: 'fetch-content', status: 'start' });
      const web = await fetchWebOutline(authorId, sourceCollectionId);
      const source = web.chapters[chapterIndex];
      if (!source) {
        send({ type: 'error', message: `The web course has no chapter ${chapterIndex}` });
        writer.close();
        return;
      }
      const lessons = pageIds.length
        ? source.lessons.filter((l) => pageIds.includes(l.pageId))
        : source.lessons;
      if (!lessons.length) {
        send({ type: 'error', message: `"${source.title}" has no lessons to read` });
        writer.close();
        return;
      }

      // Same read the generated pipeline does, eight lessons at a time.
      const texts = new Map<string, string>();
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(8, lessons.length) }, async () => {
        while (cursor < lessons.length) {
          const lesson = lessons[cursor++];
          try {
            texts.set(lesson.pageId, String(await fetchLessonContent(authorId, sourceCollectionId, lesson.pageId) || ''));
          } catch {
            // One unreadable lesson must not lose the chapter.
            texts.set(lesson.pageId, '');
          }
        }
      }));
      const combined = lessons
        .map((l) => { const t = texts.get(l.pageId) || ''; return t ? `### ${l.title}\n\n${t}` : ''; })
        .filter(Boolean)
        .join('\n\n---\n\n');
      if (!combined.trim()) {
        send({ type: 'error', message: `None of the lessons in "${source.title}" could be read` });
        writer.close();
        return;
      }
      send({ type: 'stage', name: 'fetch-content', status: 'done' });

      // Show the chapter straight away so the page can render its progress.
      const pending: MobileChapter = {
        id: chapterId,
        title: source.title,
        cards: [],
        status: 'processing',
        remoteCategoryId: source.id,
      };
      const withPending = await getMobileCourse(params.id);
      if (!withPending) throw new Error('Course disappeared while reading the web chapter');
      // After the mobile chapter paired with the nearest earlier web chapter.
      // With no pairing to go on, the end is the only honest guess.
      const earlier = pairs.filter(([w]) => w < chapterIndex).map(([, m]) => m);
      const derived = earlier.length ? Math.max(...earlier) + 1 : withPending.chapters.length;
      const at = Math.min(Math.max(insertAt >= 0 ? insertAt : derived, 0), withPending.chapters.length);
      await saveMobileCourse({
        ...withPending,
        chapters: [...withPending.chapters.slice(0, at), pending, ...withPending.chapters.slice(at)],
        updatedAt: new Date().toISOString(),
      });
      send({ type: 'chapter', chapter: pending, insertAt: at });

      const cards = await processChapter(
        course.title,
        source.title,
        lessons.map((l) => l.title).filter(Boolean),
        combined,
        params.id,
        chapterId,
        (event) => send(event),
        !!course.isScenarioCardNeeded,
      );

      // Re-read: the pipeline is long, and other chapters may have moved.
      const latest = await getMobileCourse(params.id);
      if (!latest) throw new Error('Course disappeared while generating');
      const done: MobileChapter = { ...pending, cards, status: 'done' };
      await saveMobileCourse({
        ...latest,
        chapters: latest.chapters.some((c) => c.id === chapterId)
          ? latest.chapters.map((c) => (c.id === chapterId ? done : c))
          : [...latest.chapters, done],
        updatedAt: new Date().toISOString(),
      });
      send({ type: 'done', chapter: done });
    } catch (e: any) {
      const message = e?.message || 'Could not build the chapter';
      send({ type: 'error', message });
      // Leave the failure visible rather than silently dropping the chapter.
      const latest = await getMobileCourse(params.id);
      if (latest?.chapters.some((c) => c.id === chapterId)) {
        await saveMobileCourse({
          ...latest,
          chapters: latest.chapters.map((c) =>
            c.id === chapterId ? { ...c, status: 'failed' as const, errorMessage: message } : c),
          updatedAt: new Date().toISOString(),
        });
      }
    } finally {
      writer.close();
    }
  })();

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
