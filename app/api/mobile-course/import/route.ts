import { NextRequest } from 'next/server';
import { importMobileCourse, previewMobileCourse, resolveImportTarget } from '@/lib/mobileCourseImport';

export const runtime = 'nodejs';
export const maxDuration = 600;

/** Reading only. Nothing here writes to Educative, so there is no publish gate. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const target = resolveImportTarget(String(body.collectionId || ''), body.authorId);
  if (!target) {
    return Response.json({ error: 'Give a collection URL or numeric id (and an author id if it is not in the URL)' }, { status: 400 });
  }
  try {
    if (body.preview) return Response.json({ target, ...(await previewMobileCourse(target)) });
    const course = await importMobileCourse(target);
    return Response.json({ course });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Import failed' }, { status: 502 });
  }
}
