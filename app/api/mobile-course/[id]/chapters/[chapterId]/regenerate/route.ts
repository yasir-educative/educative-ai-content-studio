import { NextRequest } from 'next/server';
import { getMobileCourse, saveMobileCourse } from '@/lib/mobileCourseStorage';
import { processChapter } from '@/lib/mobileCoursePipeline';
import { fetchCollectionWithContent } from '@/lib/courseEducative';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; chapterId: string } },
) {
  const { id, chapterId } = params;
  const course = await getMobileCourse(id);
  if (!course) return new Response('not found', { status: 404 });

  const chapter = course.chapters.find((c) => c.id === chapterId);
  if (!chapter) return new Response('chapter not found', { status: 404 });

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  function send(data: object) {
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  }

  (async () => {
    try {
      // Mark chapter as processing immediately
      await saveMobileCourse({
        ...course,
        chapters: course.chapters.map((c) =>
          c.id === chapterId ? { ...c, status: 'processing' as const } : c,
        ),
        updatedAt: new Date().toISOString(),
      });

      // Re-fetch lesson content from source Educative collection
      send({ type: 'stage', name: 'fetch-content', status: 'start' });
      const { title: collectionTitle, chapters: allChapters } = await fetchCollectionWithContent(
        course.authorId,
        course.collectionId,
      );
      const sourceChapter = allChapters.find((c) => c.id === chapterId);

      if (!sourceChapter) {
        send({ type: 'error', message: `Chapter "${chapter.title}" not found in source collection` });
        await saveMobileCourse({
          ...course,
          chapters: course.chapters.map((c) =>
            c.id === chapterId
              ? { ...c, status: 'failed' as const, errorMessage: 'Not found in source collection' }
              : c,
          ),
          updatedAt: new Date().toISOString(),
        });
        writer.close();
        return;
      }
      send({ type: 'stage', name: 'fetch-content', status: 'done' });

      const courseTitle = course.title || collectionTitle;
      const lessonTitles = sourceChapter.lessons.map((l) => l.title).filter(Boolean);
      const combinedContent = sourceChapter.lessons
        .map((l) => (l.title ? `### ${l.title}\n\n${l.content}` : l.content))
        .join('\n\n---\n\n');

      const cards = await processChapter(
        courseTitle,
        chapter.title,
        lessonTitles,
        combinedContent,
        id,
        chapterId,
        (event) => send(event),
      );

      const now = new Date().toISOString();
      // Re-read course in case other chapters changed during the long pipeline run
      const fresh = (await getMobileCourse(id)) || course;
      await saveMobileCourse({
        ...fresh,
        chapters: fresh.chapters.map((c) =>
          c.id === chapterId
            ? { ...c, cards, status: 'done' as const, regeneratedAt: now, errorMessage: undefined }
            : c,
        ),
        updatedAt: now,
      });

      send({ type: 'done', payload: { cardCount: cards.length } });
    } catch (e: any) {
      console.error('[chapter/regenerate] error:', e?.message);
      send({ type: 'error', message: e?.message || 'Unknown error' });
      const fresh = (await getMobileCourse(id)) || course;
      await saveMobileCourse({
        ...fresh,
        chapters: fresh.chapters.map((c) =>
          c.id === chapterId
            ? { ...c, status: 'failed' as const, errorMessage: e?.message }
            : c,
        ),
        updatedAt: new Date().toISOString(),
      });
    } finally {
      writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
