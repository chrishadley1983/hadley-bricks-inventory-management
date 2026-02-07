/**
 * Price Movement Alert Service
 *
 * Compares today's Amazon buy box price against the previous snapshot.
 * Sends Discord alerts when price changes exceed the threshold (default 20%).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PriceAlert {
  set_number: string;
  set_name: string | null;
  asin: string;
  old_price: number;
  new_price: number;
  change_percent: number;
  direction: 'up' | 'down';
}

export interface PriceAlertResult {
  alerts_sent: number;
  sets_checked: number;
  duration_ms: number;
}

export class PriceAlertService {
  private supabase: SupabaseClient;
  private threshold: number;

  constructor(supabase: SupabaseClient, thresholdPercent = 20) {
    this.supabase = supabase;
    this.threshold = thresholdPercent;
  }

  /**
   * Check for significant price movements and send Discord alerts.
   */
  async checkAndAlert(): Promise<PriceAlertResult> {
    const startTime = Date.now();
    const alerts: PriceAlert[] = [];

    // Get investment-tracked sets with ASINs
    const { data: sets, error: setsError } = await this.supabase
      .from('brickset_sets')
      .select('id, set_number, set_name, amazon_asin')
      .not('amazon_asin', 'is', null);

    if (setsError || !sets) {
      console.error('[PriceAlerts] Error fetching sets:', setsError?.message);
      return { alerts_sent: 0, sets_checked: 0, duration_ms: Date.now() - startTime };
    }

    // For each set with an ASIN, get the two most recent snapshots
    for (const set of sets) {
      const { data: snapshots, error: snapError } = await this.supabase
        .from('amazon_arbitrage_pricing')
        .select('snapshot_date, buy_box_price')
        .eq('asin', set.amazon_asin)
        .not('buy_box_price', 'is', null)
        .order('snapshot_date', { ascending: false })
        .limit(2);

      if (snapError || !snapshots || snapshots.length < 2) {
        continue;
      }

      const [latest, previous] = snapshots;
      const newPrice = latest.buy_box_price;
      const oldPrice = previous.buy_box_price;

      if (!newPrice || !oldPrice || oldPrice === 0) continue;

      const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;

      if (Math.abs(changePercent) >= this.threshold) {
        alerts.push({
          set_number: set.set_number,
          set_name: set.set_name,
          asin: set.amazon_asin,
          old_price: oldPrice,
          new_price: newPrice,
          change_percent: changePercent,
          direction: changePercent > 0 ? 'up' : 'down',
        });
      }
    }

    // Send Discord alerts
    if (alerts.length > 0) {
      await this.sendDiscordAlerts(alerts);
    }

    const duration = Date.now() - startTime;
    console.log(
      `[PriceAlerts] Complete: ${alerts.length} alerts sent, ${sets.length} sets checked in ${duration}ms`
    );

    return {
      alerts_sent: alerts.length,
      sets_checked: sets.length,
      duration_ms: duration,
    };
  }

  private async sendDiscordAlerts(alerts: PriceAlert[]): Promise<void> {
    const webhookUrl = process.env.DISCORD_WEBHOOK_ALERTS;
    if (!webhookUrl) {
      console.warn('[PriceAlerts] DISCORD_WEBHOOK_ALERTS not configured');
      return;
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

    for (const alert of alerts) {
      const emoji = alert.direction === 'up' ? '📈' : '📉';
      const color = alert.direction === 'up' ? 0x10b981 : 0xef4444; // green / red
      const changeStr = alert.change_percent > 0
        ? `+${alert.change_percent.toFixed(1)}%`
        : `${alert.change_percent.toFixed(1)}%`;

      const embed = {
        title: `${emoji} Price Alert: ${alert.set_number}`,
        description: alert.set_name ?? alert.set_number,
        color,
        fields: [
          { name: 'Previous Price', value: `£${alert.old_price.toFixed(2)}`, inline: true },
          { name: 'New Price', value: `£${alert.new_price.toFixed(2)}`, inline: true },
          { name: 'Change', value: changeStr, inline: true },
        ],
        url: `${baseUrl}/investment/${encodeURIComponent(alert.set_number)}`,
        timestamp: new Date().toISOString(),
      };

      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [embed] }),
        });
      } catch (err) {
        console.error(`[PriceAlerts] Discord webhook error for ${alert.set_number}:`, err);
      }
    }
  }
}
