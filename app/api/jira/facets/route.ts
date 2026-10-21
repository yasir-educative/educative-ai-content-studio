import { NextResponse } from 'next/server';
import { fetchFacets } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const c = getJiraConfig();
  if (!isConfigured(c) || !c.projectKey) return NextResponse.json({ facets: [] });
  try {
    return NextResponse.json({ facets: await fetchFacets(c, c.projectKey) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load facets', facets: [] }, { status: 400 });
  }
}
