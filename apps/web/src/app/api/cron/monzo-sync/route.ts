import { NextRequest, NextResponse } from 'next/server';
import { monzoSheetsSyncService } from '@/lib/monzo/monzo-sheets-sync.service';
import { DEFAULT_USER_ID } from '@/lib/minifig-sync/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function handler(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await monzoSheetsSyncService.performIncrementalSync(DEFAULT_USER_ID);

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[/api/cron/monzo-sync] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to sync Monzo',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handler(request);
}

export async function POST(request: NextRequest) {
  return handler(request);
}
