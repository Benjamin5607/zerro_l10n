import { NextRequest, NextResponse } from 'next/server';
import { handleWorkspaceAction } from '@/lib/engine';
import { L10nError } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');

    if (action === 'create_api_key') {
      const result = await handleWorkspaceAction({ action: 'create_api_key', ...body });
      return NextResponse.json(result, { status: 201 });
    }

    if (action === 'register' || action === 'auth_register_dev') {
      const result = await handleWorkspaceAction({
        action: 'auth_register_dev',
        ...body,
      });
      return NextResponse.json(result, { status: 201 });
    }

    return NextResponse.json(
      { error: 'Unsupported action. Use create_api_key or register.' },
      { status: 400 },
    );
  } catch (e: unknown) {
    if (e instanceof L10nError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : 'Auth request failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
