import { NextRequest, NextResponse } from 'next/server';
import { fetchIssue } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';
import { analyzeQuery } from '@/lib/queryAnalysis';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const c = getJiraConfig();
  if (!isConfigured(c)) return NextResponse.json({ error: 'Jira is not connected yet' }, { status: 400 });
  try {
    const { key } = await req.json();
    if (!key) return NextResponse.json({ error: 'issue key is required' }, { status: 400 });
    const issue = await fetchIssue(c, String(key));
    const result = await analyzeQuery(issue);
    return NextResponse.json({ key: issue.key, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Analysis failed' }, { status: 400 });
  }
}
