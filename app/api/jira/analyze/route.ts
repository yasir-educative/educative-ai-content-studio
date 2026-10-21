import { NextRequest, NextResponse } from 'next/server';
import { fetchIssue } from '@/lib/jira';
import { getJiraConfig, isConfigured } from '@/lib/jiraStore';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Placeholder for the analysis step. It already loads the full issue so the
// prompt has the description and comments to work with; what it should produce
// is still to be defined, so it reports that rather than inventing a result.
export async function POST(req: NextRequest) {
  const c = getJiraConfig();
  if (!isConfigured(c)) return NextResponse.json({ error: 'Jira is not connected yet' }, { status: 400 });
  try {
    const { key } = await req.json();
    if (!key) return NextResponse.json({ error: 'issue key is required' }, { status: 400 });
    const issue = await fetchIssue(c, String(key));
    return NextResponse.json({
      key: issue.key,
      configured: false,
      message:
        'AI analysis is not configured yet. The issue loaded successfully, so once the analysis step is defined it has the summary, description and comments to work from.',
      context: {
        summary: issue.summary,
        status: issue.status,
        descriptionChars: issue.description.length,
        commentCount: issue.comments.length,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Analysis failed' }, { status: 400 });
  }
}
