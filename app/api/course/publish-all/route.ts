import { NextRequest, NextResponse } from 'next/server';
import { listBlogs, getBlog, updateBlog } from '@/lib/storage';
import {
  createLesson,
  saveLesson,
  addPageToChapter,
  publishCourse,
  resolveImageBlocksForLesson,
  lessonUrlForIds,
  makeQuizBlock,
  makeMarkMapBlock,
  makeHintBlock,
  makePromptAiBlock,
} from '@/lib/courseEducative';

// Rebuild Quiz/MarkMap/SpoilerEditor/PromptAI blocks from stored stageOutputs["summary-elements"].
// Called before publishing so old on-disk blocks (built with stale schemas) get correct schemas.
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
  const { courseTitle, authorId: bodyAuthorId, collectionId } = body as {
    courseTitle: string;
    authorId?: string;
    collectionId: string;
  };

  if (!courseTitle || !collectionId) {
    return NextResponse.json(
      { error: 'courseTitle and collectionId are required' },
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

  const allBlogs = await listBlogs();
  const lessonSummaries = allBlogs.filter(
    (b) =>
      b.runType === 'course' &&
      (b.courseTitle || 'Untitled Course') === courseTitle
  );

  if (lessonSummaries.length === 0) {
    return NextResponse.json(
      { error: `No lessons found for course "${courseTitle}"` },
      { status: 404 }
    );
  }

  lessonSummaries.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const results: object[] = [];
  // Track the resolved collection_id from createLesson — use it for publishCourse
  let resolvedCid = collectionId;

  for (const lessonSummary of lessonSummaries) {
    const { id } = lessonSummary;
    const lessonTitle =
      lessonSummary.finalTitle ||
      (lessonSummary as any).request?.blogTitle ||
      'Lesson';

    const steps: string[] = [];
    try {
      const lessonRecord = await getBlog(id);

      if (!lessonRecord?.editorBlocks || lessonRecord.editorBlocks.length === 0) {
        results.push({ id, lessonTitle, status: 'skipped', reason: 'No editor blocks' });
        continue;
      }

      const { editorBlocks } = lessonRecord;
      const title = lessonRecord.finalTitle || lessonRecord.request?.blogTitle || 'Lesson';
      const chapterTitle = lessonRecord.request?.chapterTitle || 'Chapter 1';

      // Step 1: Create lesson page — mirrors n8n "Create lesson" node
      const { page_id: pageId, collection_id: cidFromCreate } = await createLesson(aid, collectionId);
      const cid = cidFromCreate || collectionId;
      resolvedCid = cid;
      steps.push(`created page ${pageId} in collection ${cid}`);

      // Step 1b: Rebuild widget blocks from stored stageOutputs so old on-disk records
      // (generated before schema fixes) publish with correct widget schemas.
      const patchedBlocks = patchWidgetBlocks(editorBlocks, lessonRecord.stageOutputs);
      const patchedCount = patchedBlocks.filter((b, i) => b !== editorBlocks[i]).length;
      if (patchedCount > 0) steps.push(`patched ${patchedCount} widget block(s) with current schema`);

      // Step 2: Upload images & replace temp blocks — mirrors n8n image pipeline
      const resolvedBlocks = await resolveImageBlocksForLesson(patchedBlocks, aid, cid, pageId);
      steps.push(`images resolved (${resolvedBlocks.filter((b: any) => b?.type === 'Image').length} image blocks)`);

      // Step 3: Save lesson content — mirrors n8n "Save content1" node
      await saveLesson(aid, cid, pageId, { title, blocks: resolvedBlocks });
      steps.push('lesson content saved');

      // Step 4: Fetch CHP, update categories, save CHP — mirrors n8n Fetch CHP1 → Update Categories → Save CHP
      await addPageToChapter(aid, cid, pageId, chapterTitle, title);
      steps.push(`lesson added to chapter "${chapterTitle}"`);

      const url = lessonUrlForIds(aid, cid, pageId);
      results.push({ id, lessonTitle: title, status: 'published', pageId, url, steps });
    } catch (e: any) {
      results.push({ id, lessonTitle, status: 'failed', error: e?.message, steps });
    }
  }

  // Step 5: Publish course — mirrors n8n "Publish course" node
  // Use the resolved collection_id from createLesson (same as n8n uses body.collection_id)
  let publishError: string | null = null;
  try {
    await publishCourse(aid, resolvedCid);
  } catch (e: any) {
    publishError = e?.message;
    console.error('[publish-all] publishCourse failed:', e?.message);
  }

  const summary = {
    published: results.filter((r: any) => r.status === 'published').length,
    failed: results.filter((r: any) => r.status === 'failed').length,
    skipped: results.filter((r: any) => r.status === 'skipped').length,
    total: results.length,
    publishError,
  };

  return NextResponse.json({ results, summary });
}
