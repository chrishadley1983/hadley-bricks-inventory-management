/**
 * POST /api/cron/order-issues-sync
 *
 * Periodic order-issues message sync:
 *  1. Pulls Gmail messages for every open issue (per-issue search by order #)
 *  2. Discovers new buyer-initiated messages and auto-creates issues (F19)
 *  3. Runs cross-source dedup (F20) populating duplicate_of_id by content_fingerprint
 *
 * Recommended schedule: every 30 minutes during working hours.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  OrderIssueBrickOwlAdapter,
  OrderIssueGmailAdapter,
  OrderIssueService,
} from '@/lib/services';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const start = Date.now();

  // Auth: cron secret OR internal API key
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const internalKey = request.headers.get('x-api-key');
  const expectedKey = process.env.INTERNAL_API_KEY;

  const cronOk =
    cronSecret && authHeader === `Bearer ${cronSecret}`;
  const apiKeyOk = internalKey && expectedKey && internalKey === expectedKey;
  if (!cronOk && !apiKeyOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = process.env.SERVICE_USER_ID;
  if (!userId) {
    return NextResponse.json(
      { error: 'SERVICE_USER_ID env not configured' },
      { status: 500 },
    );
  }

  try {
    const supabase = createServiceRoleClient();
    const adapter = new OrderIssueGmailAdapter(supabase);
    const service = new OrderIssueService(supabase);

    if (!OrderIssueGmailAdapter.isConfigured()) {
      return NextResponse.json(
        { error: 'Gmail not configured (missing GOOGLE_GMAIL_* env)' },
        { status: 500 },
      );
    }

    const gmailResult = await adapter.syncAll(userId, {
      discoveryWindowDays: 30,
      perIssueLimit: 50,
    });

    const boAdapter = new OrderIssueBrickOwlAdapter(supabase);
    const boResult = await boAdapter.syncAll(userId).catch((e) => ({
      issuesScanned: 0,
      messagesIngested: 0,
      messagesSkipped: 0,
      errors: [{ error: e instanceof Error ? e.message : String(e) }],
    }));

    const dedup = await service.runDedup(userId);

    const duration = Date.now() - start;
    return NextResponse.json({
      success: true,
      duration_ms: duration,
      gmail: gmailResult,
      brickowl: boResult,
      dedup,
    });
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Cron OrderIssuesSync] Error:', error);
    return NextResponse.json({ error: errorMsg, duration_ms: duration }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
