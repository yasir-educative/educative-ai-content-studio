import { NextRequest } from 'next/server';
import { fetchCollectionStructure } from '@/lib/courseEducative';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const collectionId = searchParams.get('collectionId')?.trim() || '';
  const authorId = searchParams.get('authorId')?.trim() || '10370001';

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
