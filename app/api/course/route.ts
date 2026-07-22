import { NextRequest } from 'next/server';
import { startCourseRun } from '@/lib/runManager';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/course
// Accepts { lessons: CourseInput[] } and starts one run per lesson in parallel.
// Returns { runs: [{ id, lessonTitle }] } immediately so the client can redirect.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const lessons: any[] = Array.isArray(body.lessons) ? body.lessons : [body];
    if (!lessons.length) {
      return Response.json({ error: 'No lessons provided' }, { status: 400 });
    }

    const runs = lessons.map((lesson) => {
      const handle = startCourseRun(lesson);
      return { id: handle.id, lessonTitle: lesson.lessonTitle };
    });

    return Response.json({ runs });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
