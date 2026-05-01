/**
 * BrickOwl messages adapter for order-issues.
 *
 * BrickOwl does NOT expose a public messages/comments API endpoint. The closest
 * official surface is the `buyer_note`, `seller_note`, and `public_note` fields
 * on the order detail (returned by `/order/view`). This adapter ingests those
 * as messages with `source='brickowl'`. Full buyer↔seller message threads on BO
 * would require a CDP scrape (deferred to v2). The Gmail adapter already catches
 * BO email notifications, so this gap is partially mitigated.
 *
 * Idempotency: external_message_id is composed as `brickowl-{orderId}-{noteType}-{hash}`
 * so re-running the adapter for the same notes is a no-op.
 */

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { BrickOwlClient } from '../brickowl/client';
import { CredentialsRepository, OrderIssueRepository } from '../repositories';
import { OrderIssueService } from './order-issue.service';
import type { BrickOwlCredentials } from '../brickowl/types';

export interface BrickOwlSyncResult {
  issuesScanned: number;
  messagesIngested: number;
  messagesSkipped: number;
  errors: Array<{ issueId?: string; orderId?: string; error: string }>;
}

export class OrderIssueBrickOwlAdapter {
  private readonly issues: OrderIssueRepository;
  private readonly credentials: CredentialsRepository;
  private readonly service: OrderIssueService;

  constructor(private readonly supabase: SupabaseClient<Database>) {
    this.issues = new OrderIssueRepository(supabase);
    this.credentials = new CredentialsRepository(supabase);
    this.service = new OrderIssueService(supabase);
  }

  async syncAll(userId: string): Promise<BrickOwlSyncResult> {
    const result: BrickOwlSyncResult = {
      issuesScanned: 0,
      messagesIngested: 0,
      messagesSkipped: 0,
      errors: [],
    };

    const creds = await this.credentials.getCredentials<BrickOwlCredentials>(userId, 'brickowl');
    if (!creds) {
      result.errors.push({ error: 'BrickOwl credentials not configured' });
      return result;
    }
    const client = new BrickOwlClient(creds);

    const { data: issues } = await this.issues.findByUser(
      userId,
      { openOnly: true, platform: 'brickowl' },
      { pageSize: 200 },
    );

    for (const issue of issues) {
      try {
        const r = await this.syncIssue(client, userId, {
          platform_order_id: issue.platform_order_id,
        });
        result.issuesScanned++;
        result.messagesIngested += r.ingested;
        result.messagesSkipped += r.skipped;
      } catch (e) {
        result.errors.push({
          issueId: issue.id,
          orderId: issue.platform_order_id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return result;
  }

  async syncIssue(
    client: BrickOwlClient,
    userId: string,
    args: { platform_order_id: string },
  ): Promise<{ ingested: number; skipped: number }> {
    const order = await client.getOrder(args.platform_order_id);

    let ingested = 0;
    let skipped = 0;

    const candidates: Array<{
      type: 'buyer_note' | 'seller_note' | 'public_note';
      direction: 'inbound' | 'outbound';
      from: string | null;
      body: string | null | undefined;
    }> = [
      {
        type: 'buyer_note',
        direction: 'inbound',
        from: order.buyer_name ?? null,
        body: order.buyer_note,
      },
      {
        type: 'seller_note',
        direction: 'outbound',
        from: 'Hadley Bricks',
        body: order.seller_note,
      },
      {
        type: 'public_note',
        direction: 'outbound',
        from: 'Hadley Bricks',
        body: order.public_note,
      },
    ];

    const orderTime = order.iso_order_time ?? order.order_time ?? new Date().toISOString();

    for (const c of candidates) {
      if (!c.body || !c.body.trim()) continue;
      const externalId = `brickowl-${args.platform_order_id}-${c.type}-${OrderIssueBrickOwlAdapter.hash(c.body)}`;
      const result = await this.service.ingestAutomatedMessage(userId, {
        platform: 'brickowl',
        platform_order_id: args.platform_order_id,
        source: 'brickowl',
        external_message_id: externalId,
        direction: c.direction,
        sent_at: orderTime,
        from_address: c.from,
        subject: `BrickOwl ${c.type.replace('_', ' ')}`,
        body: c.body,
      });
      if (result.skipped) skipped++;
      else ingested++;
    }
    return { ingested, skipped };
  }

  private static hash(input: string): string {
    return createHash('sha1').update(input).digest('hex').slice(0, 12);
  }
}
