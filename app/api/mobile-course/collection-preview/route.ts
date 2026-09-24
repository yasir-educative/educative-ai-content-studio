import { NextRequest } from 'next/server';
import { fetchCollectionStructure } from '@/lib/courseEducative';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const collectionId = searchParams.get('collectionId')?.trim() || '';
  const authorId = searchParams.get('authorId')?.trim() || process.env.EDUCATIVE_AUTHOR_ID || '';
  if (!authorId) {
    return Response.json({ error: 'authorId is required — set EDUCATIVE_AUTHOR_ID in .env.local or pass it explicitly' }, { status: 400 });
  }

  if (!collectionId) {
    return Response.json({ error: 'collectionId is required' }, { status: 400 });
  }

  try {
    const result = await fetchCollectionStructure(authorId, collectionId);
    return Response.json(result);
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Failed to fetch collection' }, { status: 500 });
  }
}
