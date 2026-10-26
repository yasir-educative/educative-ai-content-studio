import { NextRequest, NextResponse } from 'next/server';
import { fetchIssue } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';
import { polishReply } from '@/lib/queryAnalysis';

export const runtime = 'nodejs';
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const c = getJiraConfig();
  if (!isConfigured(c)) return NextResponse.json({ error: 'Jira is not connected yet' }, { status: 400 });
  try {
    const { key, draft } = await req.json();
    if (!key || !String(draft || '').trim()) {
      return NextResponse.json({ error: 'key and draft are required' }, { status: 400 });
    }
    const issue = await fetchIssue(c, String(key));
    return NextResponse.json({ reply: await polishReply(issue, String(draft)) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Polish failed' }, { status: 400 });
  }
}
