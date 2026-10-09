import { NextRequest } from 'next/server';
import { generateText } from '@/lib/ai';
import { getBlog } from '@/lib/storage';
import { resolveModel } from '@/lib/modelStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** How much of the surrounding article to send as context. */
const MAX_CONTEXT = 14000;
const MAX_SELECTION = 8000;

/**
 * Centre the context window on the selection.
 *
 * Sending the head of a long article would give the model the introduction and nothing near the
 * passage being edited, which is the part that actually needs to stay consistent.
 */
function windowAround(fullText: string, selection: string): string {
  if (fullText.length <= MAX_CONTEXT) return fullText;
  const at = selection ? fullText.indexOf(selection.slice(0, 120)) : -1;
  if (at < 0) return fullText.slice(0, MAX_CONTEXT);
  const half = Math.floor(MAX_CONTEXT / 2);
  const start = Math.max(0, at - half);
  return (start > 0 ? '…' : '') + fullText.slice(start, start + MAX_CONTEXT) + (start + MAX_CONTEXT < fullText.length ? '…' : '');
}

// POST /api/ai-edit — rewrite the selected passage per the user's instruction.
// Body: { instruction, selection, documentText?, sectionHeading?, blogId? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const instruction = String(body.instruction || '').trim();
    const selection = String(body.selection || '').trim();
    if (!instruction) return Response.json({ error: 'Describe the change you want' }, { status: 400 });
    if (!selection) return Response.json({ error: 'Select some text first' }, { status: 400 });
    if (selection.length > MAX_SELECTION) {
      return Response.json({ error: 'That selection is too long — select a smaller passage' }, { status: 400 });
    }

    // Prefer the text the editor sent (it reflects unsaved edits); fall back to the saved record.
    let documentText = String(body.documentText || '');
    if (!documentText && body.blogId) {
      const rec = await getBlog(String(body.blogId));
      documentText = (rec?.markdown || rec?.html || '').replace(/<[^>]+>/g, ' ');
    }

    const title = String(body.title || '').trim();
    const sectionHeading = String(body.sectionHeading || '').trim();
    const context = windowAround(documentText.replace(/\s+/g, ' ').trim(), selection);

    const prompt = `You are editing one passage inside a longer technical article. Rewrite ONLY the passage, following the instruction.

# Article title
${title || '(untitled)'}

# Section this passage sits in
${sectionHeading || '(not identified)'}

# Surrounding article, for context — do NOT rewrite or repeat this
${context || '(unavailable)'}

# The passage to rewrite
${selection}

# Instruction
${instruction}

# Rules
- Return ONLY the rewritten passage. No preamble, no explanation, no quotes around it.
- Keep the author's voice, tense and technical register — it must read as part of the same article.
- Preserve any markdown or inline formatting the passage already uses.
- Do not introduce facts that contradict the surrounding article.
- If the passage is a single sentence, return a single sentence; match its scale.`;

    const text = await generateText(prompt, { tier: 'edit', maxTokens: 4000 });
    const result = text.trim().replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
    if (!result) return Response.json({ error: 'The model returned nothing — try rephrasing' }, { status: 502 });

    return Response.json({ result, model: resolveModel('edit') });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
