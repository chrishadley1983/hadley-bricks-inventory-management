/**
 * POST /api/webhooks/keepa
 *
 * Receives push notifications from Keepa when tracked product prices change.
 * Keepa sends a single Notification object per POST.
 *
 * Must respond with 200 to confirm receipt. If delivery fails,
 * Keepa retries once after 15 seconds.
 *
 * Notification causes:
 *   0 = EXPIRED, 1 = DESIRED_PRICE, 2 = PRICE_CHANGE,
 *   3 = PRICE_CHANGE_AFTER_DESIRED_PRICE, 4 = OUT_STOCK,
 *   5 = IN_STOCK, 6 = DESIRED_PRICE_AGAIN
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { KEEPA_CSV_INDEX, keepaPriceToGBP, keepaTimestampToDate } from '@/lib/keepa/keepa-client';

const NOTIFICATION_CAUSES = [
  'EXPIRED',
  'DESIRED_PRICE',
  'PRICE_CHANGE',
  'PRICE_CHANGE_AFTER_DESIRED_PRICE',
  'OUT_STOCK',
  'IN_STOCK',
  'DESIRED_PRICE_AGAIN',
] as const;

const CSV_TYPE_NAMES: Record<number, string> = {
  [KEEPA_CSV_INDEX.AMAZON]: 'Amazon',
  [KEEPA_CSV_INDEX.NEW]: 'Marketplace New',
  [KEEPA_CSV_INDEX.USED]: 'Used',
  [KEEPA_CSV_INDEX.BUY_BOX]: 'Buy Box',
  [KEEPA_CSV_INDEX.COUNT_NEW]: 'New Offer Count',
};

interface KeepaNotification {
  asin: string;
  title?: string;
  image?: string;
  createDate: number;
  domainId: number;
  notificationDomainId?: number;
  csvType: number;
  trackingNotificationCause: number;
  currentPrices?: number[];
  metaData?: string;
}

export async function POST(request: NextRequest) {
  try {
    const notification: KeepaNotification = await request.json();

    if (!notification.asin) {
      return NextResponse.json({ error: 'Missing ASIN' }, { status: 400 });
    }

    const cause = NOTIFICATION_CAUSES[notification.trackingNotificationCause] ?? 'UNKNOWN';
    const priceType = CSV_TYPE_NAMES[notification.csvType] ?? `Type ${notification.csvType}`;
    const date = notification.createDate
      ? keepaTimestampToDate(notification.createDate)
      : new Date().toISOString().split('T')[0];

    console.log(
      `[Keepa Webhook] ${notification.asin}: ${cause} on ${priceType} (${date})`
    );

    // Extract current buy box price if available
    const buyBoxPrice = notification.currentPrices?.[KEEPA_CSV_INDEX.BUY_BOX];
    const amazonPrice = notification.currentPrices?.[KEEPA_CSV_INDEX.AMAZON];
    const currentPrice = buyBoxPrice ?? amazonPrice;
    const priceGBP = currentPrice != null ? keepaPriceToGBP(currentPrice) : null;

    // Look up which set this ASIN belongs to
    const supabase = createServiceRoleClient();
    const { data: setData } = await supabase
      .from('brickset_sets')
      .select('set_number, name, rrp_gbp')
      .eq('amazon_asin' as string, notification.asin)
      .single();

    const setRecord = setData as unknown as Record<string, unknown> | null;
    const setNumber = setRecord?.set_number as string | null;
    const setName = setRecord?.name as string | null;
    const rrp = setRecord?.rrp_gbp as number | null;

    // Store price snapshot if we have a price
    if (setNumber && priceGBP != null) {
      const today = new Date().toISOString().split('T')[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('price_snapshots')
        .upsert(
          {
            set_num: setNumber,
            date: today,
            source: 'keepa_amazon_buybox',
            price_gbp: priceGBP,
            raw_data: {
              keepa_asin: notification.asin,
              cause,
              csv_type: notification.csvType,
              all_prices: notification.currentPrices,
            },
          },
          { onConflict: 'set_num,date,source' }
        );
    }

    // Send Discord alert for significant events
    const discordWebhook = process.env.DISCORD_WEBHOOK_ALERTS;
    if (discordWebhook && shouldAlert(cause)) {
      const priceStr = priceGBP != null ? `£${priceGBP.toFixed(2)}` : 'N/A';
      const rrpStr = rrp != null ? `£${(rrp as number).toFixed(2)}` : 'N/A';
      const setLabel = setNumber ? `${setNumber} ${setName ?? ''}` : notification.asin;

      const emoji = cause === 'OUT_STOCK' ? '🔴'
        : cause === 'IN_STOCK' ? '🟢'
        : cause === 'DESIRED_PRICE' || cause === 'DESIRED_PRICE_AGAIN' ? '🎯'
        : '📊';

      await fetch(discordWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: `${emoji} Keepa: ${cause.replace(/_/g, ' ')}`,
            description: `**${setLabel}**`,
            fields: [
              { name: 'Price Type', value: priceType, inline: true },
              { name: 'Current Price', value: priceStr, inline: true },
              { name: 'RRP', value: rrpStr, inline: true },
            ],
            color: cause === 'OUT_STOCK' ? 0xff0000
              : cause === 'IN_STOCK' ? 0x00ff00
              : 0x0099ff,
            timestamp: new Date().toISOString(),
          }],
        }),
      });
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error('[Keepa Webhook] Error:', error);
    // Still return 200 to prevent Keepa retries on our processing errors
    return NextResponse.json({ received: true, error: 'Processing error' }, { status: 200 });
  }
}

function shouldAlert(cause: string): boolean {
  return [
    'DESIRED_PRICE',
    'DESIRED_PRICE_AGAIN',
    'OUT_STOCK',
    'IN_STOCK',
    'PRICE_CHANGE_AFTER_DESIRED_PRICE',
  ].includes(cause);
}
