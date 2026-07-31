import { NextResponse } from 'next/server';
import { getPluginManifest } from '@/lib/manifest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const manifest = getPluginManifest();
    return NextResponse.json(manifest);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to load plugin manifest';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
