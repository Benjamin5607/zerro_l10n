import { NextRequest, NextResponse } from 'next/server';
import { handleWorkspaceAction } from '@/lib/engine';
import { L10nError } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ locale: string }> },
) {
  try {
    const { locale } = await ctx.params;
    const projectId = req.nextUrl.searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'projectId query parameter is required' }, { status: 400 });
    }

    try {
      const result = await handleWorkspaceAction({
        action: 'ota_bundle',
        projectId,
        locale,
      });

      return NextResponse.json(result, {
        headers: {
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
          'Content-Type': 'application/json; charset=utf-8',
        },
      });
    } catch (inner: unknown) {
      // Soft-empty when project missing (ephemeral /tmp reseeds across instances)
      if (inner instanceof L10nError && inner.code === 'PROJECT_NOT_FOUND') {
        return NextResponse.json({
          projectId,
          locale,
          version: 0,
          strings: {},
          count: 0,
          empty: true,
        });
      }
      throw inner;
    }
  } catch (e: unknown) {
    if (e instanceof L10nError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : 'OTA bundle failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
