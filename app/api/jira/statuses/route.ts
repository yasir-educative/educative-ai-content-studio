import { NextResponse } from 'next/server';
import { fetchProjectStatuses } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const c = getJiraConfig();
  const want = new URL(req.url).searchParams.get('project') || c.projectKey;
  if (!isConfigured(c) || !want) return NextResponse.json({ statuses: [], project: '' });
  try {
    return NextResponse.json({ statuses: await fetchProjectStatuses(c, want), project: want });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load statuses', statuses: [], project: '' }, { status: 400 });
  }
}
