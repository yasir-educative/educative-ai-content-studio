import { NextRequest } from 'next/server';
import { createFlashCardShotCollection } from '@/lib/courseEducative';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { authorId } = await req.json().catch(() => ({}));
    const { collectionId, authorId: resolvedAuthorId } = await createFlashCardShotCollection(
      authorId ? String(authorId) : undefined,
      'flash-card-course',
    );
    return Response.json({ collectionId, authorId: resolvedAuthorId });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
