import { NextRequest, NextResponse } from 'next/server';
import { fetchIssues } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const c = getJiraConfig();
  if (!isConfigured(c)) {
    return NextResponse.json({ error: 'Jira is not connected yet', configured: false }, { status: 400 });
  }
  try {
    const max = Number(new URL(req.url).searchParams.get('max')) || 50;
    return NextResponse.json(await fetchIssues(c, Math.min(100, Math.max(1, max))));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to fetch issues' }, { status: 400 });
  }
}
