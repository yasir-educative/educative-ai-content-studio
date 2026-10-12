import { NextRequest, NextResponse } from 'next/server';
import { getBlog, updateBlog } from '@/lib/storage';
import {
  createLesson,
  saveLesson,
  addPageToChapter,
  resolveImageBlocksForLesson,
  lessonUrlForIds,
  makeQuizBlock,
  makeMarkMapBlock,
  makeHintBlock,
  makePromptAiBlock,
} from '@/lib/courseEducative';

function patchWidgetBlocks(blocks: any[], stageOutputs?: Record<string, any>): any[] {
  const se = stageOutputs?.['summary-elements'];
  if (!se) return blocks;
  const done = new Set<string>();
  return blocks.map((block) => {
    const type = block?.type;
    if (type === 'Quiz' && !done.has('Quiz') && se.quiz) {
      done.add('Quiz');
      try { return makeQuizBlock(se.quiz); } catch { return block; }
    }
    if (type === 'MarkMap' && !done.has('MarkMap') && se.markmap) {
      done.add('MarkMap');
      try { return makeMarkMapBlock(se.markmap); } catch { return block; }
    }
    if (type === 'SpoilerEditor' && !done.has('SpoilerEditor') && se.hint) {
      done.add('SpoilerEditor');
      try { return makeHintBlock(se.hint); } catch { return block; }
    }
    if (type === 'PromptAI' && !done.has('PromptAI') && se.ai_assessment) {
      done.add('PromptAI');
      try { return makePromptAiBlock(se.ai_assessment); } catch { return block; }
    }
    return block;
  });
}

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { lessonId, authorId: bodyAuthorId, collectionId } = body as {
    lessonId: string;
    authorId?: string;
    collectionId: string;
  };

  if (!lessonId || !collectionId) {
    return NextResponse.json(
      { error: 'lessonId and collectionId are required' },
      { status: 400 }
    );
  }

  const aid = bodyAuthorId || process.env.EDUCATIVE_AUTHOR_ID || '';
  if (!aid) {
    return NextResponse.json(
      { error: 'authorId is required (body or EDUCATIVE_AUTHOR_ID env var)' },
      { status: 400 }
    );
  }

  const lessonRecord = await getBlog(lessonId);
  if (!lessonRecord) {
    return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  }

  if (!lessonRecord.editorBlocks || lessonRecord.editorBlocks.length === 0) {
    return NextResponse.json({ error: 'Lesson has no editor blocks to publish' }, { status: 400 });
  }

  const rawTitle = lessonRecord.finalTitle || lessonRecord.request?.blogTitle || 'Lesson';
  const title = rawTitle.slice(0, 65);
  const chapterTitle = lessonRecord.request?.chapterTitle || 'Chapter 1';

  try {
    const patchedBlocks = patchWidgetBlocks(lessonRecord.editorBlocks, lessonRecord.stageOutputs);

    const { page_id: pageId, collection_id: cidFromCreate } = await createLesson(aid, collectionId);
    const cid = cidFromCreate || collectionId;

    const resolvedBlocks = await resolveImageBlocksForLesson(patchedBlocks, aid, cid, pageId);

    await saveLesson(aid, cid, pageId, { title, blocks: resolvedBlocks });

    await addPageToChapter(aid, cid, pageId, chapterTitle, title);

    const url = lessonUrlForIds(aid, cid, pageId);

    await updateBlog(lessonId, { publishedUrl: url, status: 'published' });

    return NextResponse.json({ status: 'published', pageId, url, title });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Publish failed' }, { status: 500 });
  }
}
