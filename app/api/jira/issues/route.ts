import { NextRequest, NextResponse } from 'next/server';
import { fetchBoardIssues, fetchIssues } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const c = getJiraConfig();
  if (!isConfigured(c)) {
    return NextResponse.json({ error: 'Jira is not connected yet', configured: false }, { status: 400 });
  }
  try {
    const sp = new URL(req.url).searchParams;
    const max = Math.min(100, Math.max(1, Number(sp.get('max')) || 50));
    // Explicit board wins, else the configured default, else fall back to JQL.
    const boardId = Number(sp.get('boardId')) || c.defaultBoardId || 0;
    if (boardId) {
      const { issues, total } = await fetchBoardIssues(c, boardId, max);
      return NextResponse.json({ issues, total, boardId, jql: c.jql || '' });
    }
    return NextResponse.json(await fetchIssues(c, max));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to fetch issues' }, { status: 400 });
  }
}
