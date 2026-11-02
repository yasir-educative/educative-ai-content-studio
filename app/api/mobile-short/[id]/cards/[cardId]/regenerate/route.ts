import { handleCardRewrite } from '@/lib/cardRewriteRoutes';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: { id: string; cardId: string; chapterId?: string } }) {
  return handleCardRewrite(req, params, 'short', 'regenerate');
}
