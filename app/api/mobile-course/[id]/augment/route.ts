import { NextRequest } from 'next/server';
import { executeProposal, placeProposals, type Proposal } from '@/lib/mobileCourseAugment';
import { checkCards } from '@/lib/mobileCardLimits';
import { getMobileCourse, updateMobileCourse } from '@/lib/mobileCourseStorage';

export const runtime = 'nodejs';
export const maxDuration = 600;

/**
 * Write the accepted proposals into the local course.
 *
 * Local only: the new cards get no pageId, so nothing exists in Educative
 * until the author publishes the additions from the course page.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const course = await getMobileCourse(params.id);
  if (!course) return Response.json({ error: 'Course not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const proposals: Proposal[] = Array.isArray(body.proposals) ? body.proposals : [];
  if (!proposals.length) return Response.json({ error: 'No proposals were accepted' }, { status: 400 });

  const logs: string[] = [];
  const log = (message: string) => { if (message) logs.push(message); };
  const placements: Array<{ proposal: Proposal; cards: any[] }> = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const proposal of proposals) {
    try {
      const cards = await executeProposal(course, proposal, log);
      placements.push({ proposal, cards });
    } catch (e: any) {
      errors.push({ id: proposal.id, error: e?.message || 'Card generation failed' });
    }
  }

  if (!placements.length) {
    return Response.json({ error: 'No cards could be written', errors, logs }, { status: 502 });
  }

  const chapters = placeProposals(course, placements);
  await updateMobileCourse(params.id, { chapters });
  const inPlace = (kind: Proposal['kind']) => kind === 'rewrite' || kind === 'media';
  const added = placements.filter((p) => !inPlace(p.proposal.kind)).reduce((n, p) => n + p.cards.length, 0);
  const rewritten = placements.filter((p) => inPlace(p.proposal.kind)).length;
  return Response.json({
    ok: errors.length === 0,
    added,
    rewritten,
    errors,
    logs,
    issues: checkCards(placements.flatMap((p) => p.cards), 'course').issues,
    course: await getMobileCourse(params.id),
  });
}
