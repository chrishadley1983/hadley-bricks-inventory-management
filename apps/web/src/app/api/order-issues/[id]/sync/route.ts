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

    const oauth = new google.auth.OAuth2(
      process.env.GOOGLE_GMAIL_CLIENT_ID,
      process.env.GOOGLE_GMAIL_CLIENT_SECRET,
    );
    oauth.setCredentials({ refresh_token: process.env.GOOGLE_GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth });

    const adapter = new OrderIssueGmailAdapter(supabase);
    const result = await adapter.syncIssue(
      gmail,
      auth.userId,
      {
        id: issue.id,
        platform: issue.platform as OrderIssuePlatform,
        platform_order_id: issue.platform_order_id,
      },
      100,
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/order-issues/[id]/sync] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
