import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { PerfLogEntry } from '@/lib/perf';

const logsDir = join(process.cwd(), 'logs');
const clientLogPath = join(logsDir, 'perf-client.jsonl');

/**
 * POST /api/perf
 * Receives batched client-side performance entries and writes to file
 */
export async function POST(request: NextRequest) {
  // Only allow in development
  if (process.env.NODE_ENV !== 'development' && process.env.PERF_LOG !== 'true') {
    return NextResponse.json({ error: 'Disabled' }, { status: 403 });
  }

  try {
    const { entries } = (await request.json()) as { entries: PerfLogEntry[] };

    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'No entries' }, { status: 400 });
    }

    // Ensure logs directory exists
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }

    // Append entries to file
    const lines = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    appendFileSync(clientLogPath, lines);

    return NextResponse.json({ written: entries.length });
  } catch (error) {
    console.error('[POST /api/perf] Error:', error);
    return NextResponse.json({ error: 'Failed to write' }, { status: 500 });
  }
}
