// Read a published mobile collection back into a local course.
//
// Reading from Educative is not a publish, so this never writes anything. The
// result is an ordinary MobileCourse marked origin: 'imported', which means the
// existing chapter and card UI renders it with no special cases.

import {
  extractCollectionIds,
  fetchCollectionStructure,
  fetchRemotePage,
  lessonUrlForIds,
} from './courseEducative';
import { parseMobileCard } from './mobileCoursePublish';
import {
  newMobileCourseId,
  saveMobileCourse,
  type MobileChapter,
  type MobileCourse,
} from './mobileCourseStorage';

export interface ImportTarget {
  authorId: string;
  collectionId: string;
}

/** Accepts a collection id, a collection URL, or a page-editor URL. */
export function resolveImportTarget(input: string, fallbackAuthorId?: string): ImportTarget | null {
  const raw = String(input || '').trim();
  const parsed = extractCollectionIds(raw);
  const collectionId = parsed.collectionId || (/^\d+$/.test(raw) ? raw : '');
  const authorId = parsed.authorId || String(fallbackAuthorId || process.env.EDUCATIVE_AUTHOR_ID || '');
  if (!/^\d+$/.test(collectionId) || !/^\d+$/.test(authorId)) return null;
  return { authorId, collectionId };
}

/** Chapters and page counts, without reading any page. Cheap enough to preview. */
export async function previewMobileCourse(target: ImportTarget) {
  const structure = await fetchCollectionStructure(target.authorId, target.collectionId);
  return {
    title: structure.title,
    chapters: structure.chapters.map((c) => ({ id: c.id, title: c.title, pageCount: c.lessons.length })),
    pageCount: structure.chapters.reduce((n, c) => n + c.lessons.length, 0),
  };
}

export async function importMobileCourse(
  target: ImportTarget,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<MobileCourse> {
  const structure = await fetchCollectionStructure(target.authorId, target.collectionId);
  const total = structure.chapters.reduce((n, c) => n + c.lessons.length, 0);
  let done = 0;

  const chapters: MobileChapter[] = [];
  for (const remote of structure.chapters) {
    const chapter: MobileChapter = {
      id: `imported-${remote.id}`,
      remoteCategoryId: remote.id,
      title: remote.title,
      status: 'done',
      cards: [],
    };
    for (const [i, lesson] of remote.lessons.entries()) {
      const page = await fetchRemotePage(target.authorId, target.collectionId, lesson.pageId);
      // A page that vanished mid-import would silently shorten the chapter.
      if (!page) throw new Error(`Page ${lesson.pageId} is no longer in the collection; preview again`);
      const card = parseMobileCard(page, {
        id: `page-${lesson.pageId}`,
        pageId: lesson.pageId,
        card_number: i + 1,
      });
      // A card we could not parse keeps the lesson's own title, which is the
      // only readable thing left about it.
      if (card.readOnly && lesson.title) card.title = lesson.title;
      card.publishedUrl = lessonUrlForIds(target.authorId, target.collectionId, lesson.pageId);
      chapter.cards.push(card);
      onProgress((done += 1), total);
    }
    chapters.push(chapter);
  }

  const now = new Date().toISOString();
  const course: MobileCourse = {
    id: newMobileCourseId(),
    origin: 'imported',
    createdAt: now,
    updatedAt: now,
    status: 'published',
    title: structure.title,
    // The source course is unknown on import; the author can set it later.
    collectionId: '',
    targetCollectionId: target.collectionId,
    authorId: target.authorId,
    chapters,
    publishedUrl: `https://www.educative.io/collection/${target.authorId}/${target.collectionId}`,
  };
  await saveMobileCourse(course);
  return course;
}
