import { NextRequest, NextResponse } from 'next/server';
import { fetchIssue } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { key: string } }) {
  const c = getJiraConfig();
  if (!isConfigured(c)) return NextResponse.json({ error: 'Jira is not connected yet' }, { status: 400 });
  try {
    return NextResponse.json(await fetchIssue(c, params.key));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load issue' }, { status: 400 });
  }
}
