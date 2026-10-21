import { NextRequest, NextResponse } from 'next/server';
import { fetchTransitions, postUpdate } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const c = getJiraConfig();
  if (!isConfigured(c)) return NextResponse.json({ error: 'Jira is not connected yet' }, { status: 400 });
  const key = new URL(req.url).searchParams.get('key') || '';
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 });
  try {
    return NextResponse.json({ transitions: await fetchTransitions(c, key) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load transitions', transitions: [] }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const c = getJiraConfig();
  if (!isConfigured(c)) return NextResponse.json({ error: 'Jira is not connected yet' }, { status: 400 });
  try {
    return NextResponse.json(await postUpdate(c, await req.json()));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to post update' }, { status: 400 });
  }
}
