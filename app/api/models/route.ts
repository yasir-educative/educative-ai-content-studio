import { NextRequest } from 'next/server';
import { getModelConfig, saveModelConfig, resetModelConfig, defaultConfig } from '@/lib/modelStore';

export const runtime = 'nodejs';
// Without this Next prerenders the route (its GET takes no input), and the static handler
// answers PUT with 405.
export const dynamic = 'force-dynamic';

/** Models the key can actually use, so the picker cannot offer something that will 400. */
async function listAvailableModels(): Promise<{ models: string[]; error?: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { models: [], error: 'OPENAI_API_KEY is not set' };
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      // The catalogue changes rarely; a short cache keeps the settings page snappy.
      next: { revalidate: 300 },
    });
    if (!res.ok) return { models: [], error: `OpenAI model list failed: ${res.status}` };
    const json: any = await res.json();
    const ids: string[] = (json?.data || []).map((m: any) => m.id);
    // Chat-completions models only — drop audio/image/embedding/search/etc.
    const chat = ids
      .filter((id) => /^(gpt|o[1-9])/.test(id))
      .filter((id) => !/audio|realtime|image|tts|whisper|transcribe|embedding|moderation|search|codex|sora|instruct/.test(id))
      .sort();
    return { models: chat };
  } catch (e: any) {
    return { models: [], error: e?.message || String(e) };
  }
}

export async function GET() {
  const [{ models, error }] = await Promise.all([listAvailableModels()]);
  return Response.json({
    config: getModelConfig(),
    defaults: defaultConfig(),
    models,
    modelsError: error,
    // Search is configured in the environment, not here.
    searchModel: process.env.OPENAI_SEARCH_MODEL || 'gpt-5-search-api',
  });
}

export async function PUT(req: NextRequest) {
  try {
    const { mainModel, normalModel, editModel, reset } = await req.json();
    const config = reset ? resetModelConfig() : saveModelConfig({ mainModel, normalModel, editModel });
    return Response.json({ config });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 400 });
  }
}
