import { NextResponse } from 'next/server';
import { fetchProjects } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const c = getJiraConfig();
  if (!isConfigured(c)) return NextResponse.json({ error: 'Jira is not connected yet' }, { status: 400 });
  try {
    return NextResponse.json({ projects: await fetchProjects(c) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load projects' }, { status: 400 });
  }
}
