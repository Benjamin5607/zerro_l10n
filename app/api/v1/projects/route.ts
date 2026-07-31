import { NextRequest, NextResponse } from 'next/server';
import { handleWorkspaceAction } from '@/lib/engine';
import { L10nError } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const result = await handleWorkspaceAction({ action: 'list_projects' });
    return NextResponse.json(result);
  } catch (e: unknown) {
    if (e instanceof L10nError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : 'Failed to list projects';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await handleWorkspaceAction({
      action: 'create_project',
      ...body,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof L10nError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : 'Failed to create project';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
