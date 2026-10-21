import { NextRequest, NextResponse } from 'next/server';
import { fetchAssigneeBoards } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const c = getJiraConfig();
  if (!isConfigured(c)) return NextResponse.json({ boards: [], sampled: 0, capped: false });
  try {
    const id = new URL(req.url).searchParams.get('accountId') || undefined;
    return NextResponse.json(await fetchAssigneeBoards(c, id));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed', boards: [], sampled: 0, capped: false }, { status: 400 });
  }
}
