import { NextRequest, NextResponse } from 'next/server';
import { getJiraConfig, redactJira, saveJiraConfig, clearJiraConfig } from '@/lib/jiraStore';
import { testConnection } from '@/lib/jira';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(redactJira());
}

export async function PUT(req: NextRequest) {
  try {
    await saveJiraConfig(await req.json());
    return NextResponse.json(redactJira());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to save' }, { status: 400 });
  }
}

// Verify the stored credentials against Jira.
export async function POST() {
  try {
    const who = await testConnection(getJiraConfig());
    return NextResponse.json({ ok: true, ...who });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Connection failed' }, { status: 400 });
  }
}

export async function DELETE() {
  await clearJiraConfig();
  return NextResponse.json(redactJira());
}
