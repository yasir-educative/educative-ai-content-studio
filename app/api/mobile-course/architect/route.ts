import { NextRequest } from 'next/server';
import { generateText, parseJsonLoose } from '@/lib/ai';
import { registeredArchitectPrompt } from '@/lib/mobileCoursePromptsRegistry';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { topic, domain, description, outline } = await req.json();
    if (!topic?.trim()) return Response.json({ error: 'topic is required' }, { status: 400 });

    const prompt = registeredArchitectPrompt({
      topic: String(topic || '').trim(),
      domain: String(domain || '').trim(),
      description: String(description || '').trim(),
      outline: String(outline || '').trim(),
    });

    const result = await generateText(prompt, { maxTokens: 20000, noThinking: true });
    let plan: any;
    try {
      plan = parseJsonLoose(result);
    } catch (parseErr: any) {
      const msg = String(parseErr?.message || parseErr);
      const posMatch = msg.match(/position (\d+)/);
      if (posMatch) {
        const pos = parseInt(posMatch[1]);
        console.error('[architect] JSON parse failed at pos', pos, '— snippet:', JSON.stringify(result.slice(Math.max(0, pos - 120), pos + 120)));
      }
      console.error('[architect] raw output length:', result.length, '— first 300:', result.slice(0, 300));
      throw parseErr;
    }
    if (!plan?.courseName || !Array.isArray(plan?.chapters)) {
      return Response.json({ error: 'AI did not return a valid course plan. Please try again.' }, { status: 502 });
    }
    return Response.json({ plan });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
