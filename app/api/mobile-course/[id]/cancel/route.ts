import { NextRequest } from 'next/server';
import { cancelMobileCourseRun } from '@/lib/mobileCourseRunManager';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const cancelled = cancelMobileCourseRun(params.id);
  return Response.json({ cancelled });
}
