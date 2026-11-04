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

/** Attachments travel as base64 in the JSON body, so cap what one post may carry. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const c = getJiraConfig();
  if (!isConfigured(c)) return NextResponse.json({ error: 'Jira is not connected yet' }, { status: 400 });
  try {
    const body = await req.json();
    const files = Array.isArray(body?.attachments) ? body.attachments : [];
    // base64 is 4 characters per 3 bytes; close enough to refuse before uploading.
    const bytes = files.reduce((sum: number, f: any) => sum + Math.floor(String(f?.data || '').length * 0.75), 0);
    if (bytes > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: `Attachments total ${(bytes / 1024 / 1024).toFixed(1)}MB; the limit is 10MB` }, { status: 400 });
    }
    return NextResponse.json(await postUpdate(c, body));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to post update' }, { status: 400 });
  }
}
