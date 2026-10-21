import { NextResponse } from 'next/server';
import { fetchProjectStatuses } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const c = getJiraConfig();
  if (!isConfigured(c) || !c.projectKey) {
    return NextResponse.json({ statuses: [] });
  }
  try {
    return NextResponse.json({ statuses: await fetchProjectStatuses(c, c.projectKey) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load statuses', statuses: [] }, { status: 400 });
  }
}
