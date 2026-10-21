import { NextResponse } from 'next/server';
import { fetchFacets } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const c = getJiraConfig();
  const want = new URL(req.url).searchParams.get('project') || c.projectKey;
  if (!isConfigured(c) || !want) return NextResponse.json({ facets: [], project: '' });
  try {
    return NextResponse.json({ facets: await fetchFacets(c, want), project: want });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load facets', facets: [], project: '' }, { status: 400 });
  }
}
