import { NextRequest, NextResponse } from 'next/server';
import { handleWorkspaceAction } from '@/lib/engine';
import { L10nError } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

type ChatMessage = { role: string; content: string };

interface LlmBody {
  base_url?: string;
  api_key?: string;
  model?: string;
  temperature?: number;
  models?: {
    translator?: string;
    reviewer?: string;
    qa?: string;
  };
}

function buildCompleteChat(llm: LlmBody) {
  const baseUrl = String(llm.base_url || '').replace(/\/$/, '');
  if (!baseUrl) return undefined;

  return async (messages: ChatMessage[], role: string): Promise<string> => {
    const roleModel =
      role === 'translator'
        ? llm.models?.translator
        : role === 'reviewer'
          ? llm.models?.reviewer
          : role === 'qa'
            ? llm.models?.qa
            : undefined;
    const model = roleModel || llm.model || 'default';

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(llm.api_key ? { Authorization: `Bearer ${llm.api_key}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: llm.temperature ?? 0.3,
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() || '';
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const llm = body?.llm && typeof body.llm === 'object' ? (body.llm as LlmBody) : null;
    const completeChat = llm?.base_url ? buildCompleteChat(llm) : undefined;

    const result = await handleWorkspaceAction(body, { completeChat });
    return NextResponse.json(result);
  } catch (e: unknown) {
    if (e instanceof L10nError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : 'Workspace action failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
