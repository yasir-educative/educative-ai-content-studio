import { NextRequest, NextResponse } from 'next/server';
import { searchUsers } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const c = getJiraConfig();
  if (!isConfigured(c)) return NextResponse.json({ users: [] });
  const q = new URL(req.url).searchParams.get('q') || '';
  try {
    return NextResponse.json({ users: await searchUsers(c, q) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Search failed', users: [] }, { status: 400 });
  }
}
