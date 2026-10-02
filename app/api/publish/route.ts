import { NextRequest } from 'next/server';
import { publishToChannel } from '@/lib/publishers';
import { listChannels } from '@/lib/channelStore';
import { getBlog, updateBlog, type PublishTarget } from '@/lib/storage';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Fall back to the first Educative channel when the caller names no destination. */
function defaultChannelId(): string {
  const educative = listChannels().find((c) => c.type === 'educative');
  if (!educative) throw new Error('No publishing channel configured — add one on /channels');
  return educative.id;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 70)
    .replace(/-$/, '');
}

// POST /api/publish
// Body: { channelId?, blogId?, title?, blocks?, html?, markdown?, summary?, slug?, status?, canonicalUrl? }
//
// channelId selects the destination. Omitting it preserves the original behaviour (Educative),
// so existing callers keep working. Anything the caller leaves out is filled in from the saved
// run record, which is what lets the history page re-publish with only a blogId.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const channelId: string = body.channelId || defaultChannelId();

    const saved = body.blogId ? await getBlog(body.blogId) : null;

    const title: string = body.title || saved?.finalTitle || saved?.request?.blogTitle || 'Untitled';
    const blocks: any[] | undefined = body.blocks ?? saved?.editorBlocks;
    const html: string | undefined = body.html ?? saved?.html;
    const markdown: string | undefined = body.markdown ?? saved?.markdown;
    const summary: string | undefined = body.summary ?? saved?.request?.blogSummary ?? undefined;

    if (!blocks?.length && !html && !markdown) {
      return Response.json({ error: 'Nothing to publish — no editor blocks, HTML, or markdown' }, { status: 400 });
    }

    // A previous publish to this same channel means "update that item", not "create a second one".
    const existingExternalId = saved?.publishTargets?.[channelId]?.externalId || undefined;

    const result = await publishToChannel(channelId, {
      title,
      blocks,
      html,
      markdown,
      summary: summary || undefined,
      slug: body.slug || slugify(title),
      status: body.status,
      canonicalUrl: body.canonicalUrl,
      blogId: body.blogId,
      existingExternalId,
      educative: {
        templateId: body.templateId,
        categories: body.categories,
        pageType: body.pageType,
      },
    });

    if (body.blogId && saved) {
      const target: PublishTarget = {
        channelId: result.channelId,
        channelName: result.channelName,
        channelType: result.channelType,
        url: result.url,
        externalId: result.externalId,
        publishedAt: new Date().toISOString(),
        warnings: result.warnings?.length ? result.warnings : undefined,
        images: (result.meta as any)?.images && Object.keys((result.meta as any).images).length
          ? (result.meta as any).images
          : undefined,
      };
      try {
        await updateBlog(body.blogId, {
          status: 'published',
          publishedUrl: result.url,
          publishedAt: target.publishedAt,
          publishTargets: { ...(saved.publishTargets || {}), [result.channelId]: target },
        });
      } catch (e) {
        console.error('[history] publish recorded but save failed', e);
      }
    }

    return Response.json({
      url: result.url,
      channelId: result.channelId,
      channelName: result.channelName,
      channelType: result.channelType,
      externalId: result.externalId,
      mediaCount: result.mediaCount,
      warnings: result.warnings || [],
      // Legacy fields kept so older callers reading pageId/editorPageId keep working.
      ...(result.meta || {}),
    });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
