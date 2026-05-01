/**
 * POST /api/order-issues/[id]/sync
 *
 * Manually triggers Gmail sync for a single issue. Useful for verifying ingestion
 * without waiting for the cron.
 */

import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { OrderIssueGmailAdapter } from '@/lib/services';
import { OrderIssueRepository } from '@/lib/repositories';
import type { OrderIssuePlatform } from '@/lib/schemas/order-issue.schema';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await validateAuth(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!OrderIssueGmailAdapter.isConfigured()) {
      return NextResponse.json(
        { error: 'Gmail not configured (missing GOOGLE_GMAIL_* env)' },
        { status: 500 },
      );
    }

    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();

    const issues = new OrderIssueRepository(supabase);
    const issue = await issues.findById(id);
    if (!issue || issue.user_id !== auth.userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const accounts = OrderIssueGmailAdapter.getAccountConfigs();
    const adapter = new OrderIssueGmailAdapter(supabase);

    let totalIngested = 0;
    let totalSkipped = 0;
    const perAccount: Array<{ label: string; ingested: number; skipped: number; error?: string }> = [];

    for (const acc of accounts) {
      const oauth = new google.auth.OAuth2(acc.clientId, acc.clientSecret);
      oauth.setCredentials({ refresh_token: acc.refreshToken });
      const gmail = google.gmail({ version: 'v1', auth: oauth });
      try {
        const r = await adapter.syncIssue(
          gmail,
          auth.userId,
          {
            id: issue.id,
            platform: issue.platform as OrderIssuePlatform,
            platform_order_id: issue.platform_order_id,
          },
          100,
        );
        totalIngested += r.ingested;
        totalSkipped += r.skipped;
        perAccount.push({ label: acc.label, ingested: r.ingested, skipped: r.skipped });
      } catch (e) {
        perAccount.push({
          label: acc.label,
          ingested: 0,
          skipped: 0,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return NextResponse.json({ data: { ingested: totalIngested, skipped: totalSkipped, perAccount } });
  } catch (error) {
    console.error('[POST /api/order-issues/[id]/sync] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
