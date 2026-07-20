/**
 * Discord Notification Service
 *
 * Sends rich embed notifications to Discord channels via webhooks.
 * Replaces Pushover for consolidated alerting across multiple channels.
 *
 * Channels:
 * - #alerts: Failures, CAPTCHA, errors, cron errors
 * - #opportunities: Vinted arbitrage opportunities
 * - #sync-status: Sync started, sync complete, pricing updates, offers sent
 * - #daily-summary: End-of-day summaries
 * - #peter-chat: Peter bot channel for actionable notifications
 *
 * Setup:
 * 1. Create webhooks in Discord server: Edit Channel → Integrations → Webhooks
 * 2. Add webhook URLs to .env.local:
 *    - DISCORD_WEBHOOK_ALERTS
 *    - DISCORD_WEBHOOK_OPPORTUNITIES
 *    - DISCORD_WEBHOOK_SYNC_STATUS
 *    - DISCORD_WEBHOOK_DAILY_SUMMARY
 *    - DISCORD_WEBHOOK_PETER_CHAT
 */

import { formatSalesRank } from '@/lib/utils';

export interface SyncFailureParams {
  feedId: string;
  itemCount: number;
  reason: string;
  phase: 'price_verification' | 'price_rejected' | 'quantity_rejected' | 'quantity_verification';
}

export interface SyncSuccessParams {
  feedId: string;
  itemCount: number;
  verificationTime: number;
}


export interface EbayAuctionAlertParams {
  setNumber: string;
  setName: string | null;
  ebayTitle: string;
  currentBid: number;
  postage: number;
  totalCost: number;
  bidCount: number;
  minutesRemaining: number;
  // Amazon resale leg — null/absent for used-POV opportunities.
  amazonPrice?: number | null;
  amazon90dAvg?: number | null;
  amazonAsin?: string | null;
  salesRank?: number | null;
  profit?: number | null;
  marginPercent?: number | null;
  roiPercent?: number | null;
  alertTier: 'great' | 'good';
  ebayUrl: string;
  imageUrl: string | null;
  ukRrp?: number | null;
  maxBid?: number | null;
  // Part-Out-Value (condition-matched)
  conditionMode?: 'new' | 'used';
  povSoldGbp?: number | null;
  povForSaleGbp?: number | null;
  povMultiple?: number | null;
  povLots?: number | null;
  signals?: string[];
  flags?: string[];
  altNewPovSoldGbp?: number | null;
}

export interface EbayBinPartoutAlertParams {
  conditionMode?: 'used' | 'new';
  sets: Array<{
    setNumber: string;
    setName: string | null;
    theme: string | null;
    yearFrom: number | null;
    rrpGbp: number | null;
    usedPovGbp: number;
    newPovGbp?: number | null;
    figSharePct: number | null;
    ebayFloorGbp: number | null;
  }>;
  title: string;
  priceGbp: number;
  postageGbp: number;
  totalCostGbp: number;
  povTotal: number;
  multiple: number | null;
  /** Liquidity-adjusted ("realisable") POV — spec §3 F4. null when no set-level STR
   *  signal was available (cache coverage is thin); do not treat as "no data = £0". */
  realisablePovGbp?: number | null;
  povCaptureRate?: number | null; // 0..1
  amazonPriceGbp?: number | null;
  amazonProfitGbp?: number | null;
  amazonMarginPct?: number | null;
  amazon90dGbp?: number | null;
  salesRank?: number | null;
  asin?: string | null;
  signals?: string[];
  tier: 'great' | 'good';
  bestOfferEnabled: boolean;
  offerSuggestionGbp: number | null;
  flags: string[];
  sellerUsername: string | null;
  sellerScore: number | null;
  itemUrl: string | undefined;
  imageUrl: string | undefined;
  condition: string | undefined;
}

export interface PgCanaryDivergence {
  /** e.g. "P 3001 c11" */
  label: string;
  /** lane name -> UK sold-new average GBP (null if that lane had no data this run) */
  lanes: Record<string, number | null>;
  maxDivergencePct: number;
}

export interface PgCanaryAlertParams {
  runDate: string;
  divergentCount: number;
  totalTuples: number;
  divergences: PgCanaryDivergence[];
}

/** One row of the digest's STR-mover / fig-radar-mover lists (spec §5.3). */
export interface PgDigestMoverRow {
  /** e.g. "P 3001 c11" */
  label: string;
  /** Combined sold6m qty delta (new+used) between the two most recent snapshots. */
  qtyDelta: number;
  latestStrNew?: number | null;
  latestStrUsed?: number | null;
}

/** Per-lane 7-day telemetry rollup for the digest's coverage/freshness section. */
export interface PgDigestLaneTelemetry {
  lane: string;
  requests7d: number;
  ok7d: number;
  failed7d: number;
  /** Short human summary of the sessions-to-first-403 trend, e.g. "flat ~410" or "tightening 430→370". */
  firstBlockTrend: string;
}

/** Coverage/freshness health block (spec §5.3/§5.4), sourced from the canonical
 * pg_coverage_report view — truth is L3 presence + fetched_at, never the queue's
 * last_refreshed_at (2026-07-20 coverage audit). */
export interface PgDigestCoverageHealth {
  l1Total: number;
  activeTierCount: number;
  /** % of the active tier genuinely covered within its cycle (real UK scrape or
   * recorded no-data, fresh per the 60d policy). */
  activeCoveredFreshPct: number;
  /** % of the active tier with UK-native sold data (the usable-price yield). */
  activeUkSoldPct: number;
  /** Active-tier tuples never scraped — the first-touch backlog. */
  activeNeverScraped: number;
  /** Tuples (both tiers) whose scrape has outlived its 60/90d cycle. */
  staleCount: number;
  /** Active-tier tuples whose next_due_at has already passed. */
  pastDueCount: number;
  laneTelemetry: PgDigestLaneTelemetry[];
  /** Queue growth over the last 7 days, split by source — watch this taper toward zero
   * once the catalogue is fully enrolled (Chris 2026-07-15). */
  growth7d: { total: number; storeDiscovered: number; newRelease: number; backfill: number };
}

/** A markdown report's top-N lines for one section, carried into the digest verbatim. */
export interface PgDigestReportExcerpt {
  title: string;
  lines: string[];
}

export interface PgDigestAlertParams {
  runDate: string;
  strRisers: PgDigestMoverRow[];
  strFallers: PgDigestMoverRow[];
  figMovers: PgDigestMoverRow[];
  coverage: PgDigestCoverageHealth;
  /** Top-5-per-section excerpts from the most recent own-store-audit report (last 7 days), if any. */
  ownStoreAuditExcerpts: PgDigestReportExcerpt[];
  /** Path to the full markdown digest report on disk, for reference in the embed. */
  reportPath: string;
}

export interface EbayJoblotAlertParams {
  ebayTitle: string;
  currentBid: number;
  postage: number;
  totalCost: number;
  bidCount: number;
  minutesRemaining: number;
  totalAmazonValue: number;
  estimatedProfit: number;
  marginPercent: number;
  sets: Array<{ setNumber: string; setName: string | null; amazonPrice: number | null }>;
  ebayUrl: string;
  imageUrl: string | null;
}


/** Discord embed colour constants */
export const DiscordColors = {
  RED: 0xed4245, // Error/failure
  GREEN: 0x57f287, // Success
  BLUE: 0x3498db, // Info/started
  YELLOW: 0xfee75c, // Warning (COG 30-40%)
  ORANGE: 0xe67e22, // Partial success / COG > 40%
} as const;

/** Discord channel types for routing */
export type DiscordChannel =
  | 'alerts'
  | 'opportunities'
  | 'sync-status'
  | 'daily-summary'
  | 'peter-chat';

/** Discord embed field structure */
export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

/** Discord embed footer structure */
export interface DiscordEmbedFooter {
  text: string;
  icon_url?: string;
}

/** Discord embed structure */
export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: DiscordEmbedFooter;
  timestamp?: string;
}

/** Result of a send operation */
export interface DiscordSendResult {
  success: boolean;
  error?: string;
  /** True when the send never reached Discord because the channel's webhook env var is absent. */
  skipped?: boolean;
}

/** Parameters for sendAlert method */
export interface SendAlertParams {
  title: string;
  message: string;
  priority?: 'low' | 'normal' | 'high';
  url?: string;
  urlTitle?: string;
}

/** Parameters for sendOpportunity method */
export interface SendOpportunityParams {
  setNumber: string;
  setName: string;
  vintedPrice: number;
  amazonPrice: number;
  cogPercent: number;
  profit: number;
  vintedUrl: string;
}

/** Parameters for sendSyncStatus method */
export interface SendSyncStatusParams {
  title: string;
  message: string;
  success?: boolean;
  url?: string;
}

/** Parameters for sendDailySummary method */
export interface SendDailySummaryParams {
  title: string;
  fields: DiscordEmbedField[];
}

export class DiscordService {
  private readonly timeout = 5000; // 5 second timeout

  // Read webhook config lazily on each access rather than caching it in the constructor.
  // The exported singleton is instantiated at module-import time — which, in tsx scripts,
  // runs BEFORE the script calls dotenv.config() to load .env.local. Caching the webhooks
  // in the constructor captured an empty env and made every channel silently "not
  // configured", so local alerts never posted. A getter re-reads process.env after env
  // has loaded (no effect on Next.js/Vercel, where env is present before any read).
  private get webhooks(): Record<DiscordChannel, string | undefined> {
    return {
      alerts: process.env.DISCORD_WEBHOOK_ALERTS,
      opportunities: process.env.DISCORD_WEBHOOK_OPPORTUNITIES,
      'sync-status': process.env.DISCORD_WEBHOOK_SYNC_STATUS,
      'daily-summary': process.env.DISCORD_WEBHOOK_DAILY_SUMMARY,
      'peter-chat': process.env.DISCORD_WEBHOOK_PETER_CHAT,
    };
  }

  private get appUrl(): string {
    return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  }

  /**
   * Check if Discord is enabled (at least one webhook configured)
   */
  isEnabled(): boolean {
    return Object.values(this.webhooks).some((url) => !!url);
  }

  /**
   * Check if a specific channel is enabled
   */
  isChannelEnabled(channel: DiscordChannel): boolean {
    return !!this.webhooks[channel];
  }

  /**
   * Create standard embed with footer and timestamp
   */
  private createEmbed(embed: DiscordEmbed): DiscordEmbed {
    return {
      ...embed,
      footer: embed.footer || { text: 'Hadley Bricks' },
      timestamp: embed.timestamp || new Date().toISOString(),
    };
  }

  /**
   * Send an embed to a Discord channel
   */
  async send(channel: DiscordChannel, embed: DiscordEmbed): Promise<DiscordSendResult> {
    const webhookUrl = this.webhooks[channel];

    if (!webhookUrl) {
      // A missing webhook must be a FAILURE, not a silent success: returning
      // success here masked a 4-day total alert outage (2026-07-10..14, stale
      // service env) because every caller trusted the return value.
      console.error(`[DiscordService] Channel ${channel} not configured - send FAILED`);
      return {
        success: false,
        skipped: true,
        error: `Channel ${channel} not configured (missing DISCORD_WEBHOOK_* env var)`,
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [this.createEmbed(embed)] }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(
          `[DiscordService] Channel ${channel} failed with status ${response.status}: ${errorText}`
        );
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      console.log(`[DiscordService] Sent to ${channel}`);
      return { success: true };
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        console.error(`[DiscordService] Channel ${channel} timed out after ${this.timeout}ms`);
        return { success: false, error: 'Request timed out' };
      }

      console.error(`[DiscordService] Channel ${channel} error:`, err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  // =========================================================================
  // Typed Alert Methods
  // =========================================================================

  /**
   * Send an alert to the #alerts channel (errors, failures, warnings)
   */
  async sendAlert(params: SendAlertParams): Promise<DiscordSendResult> {
    const { title, message, url, urlTitle } = params;

    const embed: DiscordEmbed = {
      title,
      description: message,
      color: DiscordColors.RED,
      url,
    };

    // Add app link field if URL provided
    if (url && urlTitle) {
      embed.fields = [{ name: 'Action', value: `[${urlTitle}](${url})`, inline: false }];
    }

    return this.send('alerts', embed);
  }

  /**
   * Send an opportunity to the #opportunities channel
   * Colour-coded by COG%: green <30%, yellow 30-40%, orange >40%
   */
  async sendOpportunity(params: SendOpportunityParams): Promise<DiscordSendResult> {
    const { setNumber, setName, vintedPrice, amazonPrice, cogPercent, profit, vintedUrl } = params;

    // Colour by COG threshold
    let color: number;
    if (cogPercent < 30) {
      color = DiscordColors.GREEN;
    } else if (cogPercent <= 40) {
      color = DiscordColors.YELLOW;
    } else {
      color = DiscordColors.ORANGE;
    }

    const embed: DiscordEmbed = {
      title: `🎯 ${setNumber}: ${setName}`,
      url: vintedUrl,
      color,
      fields: [
        { name: 'Vinted Price', value: `£${vintedPrice.toFixed(2)}`, inline: true },
        { name: 'Amazon Price', value: `£${amazonPrice.toFixed(2)}`, inline: true },
        { name: 'COG%', value: `${cogPercent.toFixed(0)}%`, inline: true },
        { name: 'Profit', value: `£${profit.toFixed(2)}`, inline: true },
        {
          name: 'View in App',
          value: `[Arbitrage Dashboard](${this.appUrl}/arbitrage/vinted)`,
          inline: false,
        },
      ],
    };

    return this.send('opportunities', embed);
  }

  /**
   * Send a sync status update to the #sync-status channel
   * Colour: green for success, blue for info/started, orange for partial
   */
  async sendSyncStatus(params: SendSyncStatusParams): Promise<DiscordSendResult> {
    const { title, message, success, url } = params;

    let color: number;
    if (success === true) {
      color = DiscordColors.GREEN;
    } else if (success === false) {
      color = DiscordColors.ORANGE;
    } else {
      color = DiscordColors.BLUE; // info/started
    }

    const embed: DiscordEmbed = {
      title,
      description: message,
      color,
      url,
    };

    return this.send('sync-status', embed);
  }

  /**
   * Send a daily summary to the #daily-summary channel
   */
  async sendDailySummary(params: SendDailySummaryParams): Promise<DiscordSendResult> {
    const { title, fields } = params;

    const embed: DiscordEmbed = {
      title,
      color: DiscordColors.BLUE,
      fields,
    };

    return this.send('daily-summary', embed);
  }

  // =========================================================================
  // Convenience Methods
  // =========================================================================

  /**
   * Send two-phase sync failure notification
   * SendsendSyncFailure
   */
  async sendSyncFailure(params: SyncFailureParams): Promise<void> {
    const { feedId, itemCount, reason, phase } = params;

    const phaseLabels = {
      price_verification: 'Price verification timeout',
      price_rejected: 'Price feed rejected',
      quantity_rejected: 'Quantity feed rejected',
      quantity_verification: 'Quantity verification timeout',
    };

    await this.sendAlert({
      title: '⚠️ Amazon Sync Failed',
      message: `${phaseLabels[phase]}: ${reason}\n${itemCount} item(s) affected`,
      priority: 'high',
      url: `${this.appUrl}/amazon-sync?feed=${feedId}`,
      urlTitle: 'View Feed Details',
    });
  }

  /**
   * Send two-phase sync success notification
   * SendsendSyncSuccess
   */
  async sendSyncSuccess(params: SyncSuccessParams): Promise<void> {
    const { feedId, itemCount, verificationTime } = params;
    const timeStr =
      verificationTime > 60000
        ? `${Math.round(verificationTime / 60000)} min`
        : `${Math.round(verificationTime / 1000)} sec`;

    await this.sendSyncStatus({
      title: '✅ Amazon Sync Complete',
      message: `${itemCount} item(s) synced successfully\nPrice verified in ${timeStr}`,
      success: true,
      url: `${this.appUrl}/amazon-sync?feed=${feedId}`,
    });
  }

  // =========================================================================
  // eBay Auction Sniper Methods
  // =========================================================================

  /**
   * Send an eBay auction opportunity alert.
   * Colour-coded: green for great deals (≥30% margin), amber for good deals (≥25%).
   */
  async sendEbayAuctionAlert(params: EbayAuctionAlertParams): Promise<DiscordSendResult> {
    const {
      setNumber, setName, ebayTitle, currentBid, postage, totalCost,
      bidCount, minutesRemaining, amazonPrice, amazon90dAvg, amazonAsin,
      salesRank, profit, marginPercent, roiPercent, alertTier,
      ebayUrl, imageUrl, ukRrp, maxBid,
      conditionMode = 'new', povSoldGbp, povForSaleGbp, povMultiple, povLots, signals = [], flags = [], altNewPovSoldGbp,
    } = params;

    const color = alertTier === 'great' ? 0x2ecc71 : 0xf1c40f; // Green or amber
    const tierEmoji = alertTier === 'great' ? '🟢' : '🟠';
    // BL-cache-sourced set names embed the set number — strip to avoid "75137 75137 …".
    const cleanSetName = setName ? setName.replace(new RegExp(`^${setNumber}\\s*`), '') : null;
    const setLabel = `${setNumber}${cleanSetName ? ` ${cleanSetName}` : ''}`;

    const amazonFired = marginPercent != null && signals.some((s) => s.startsWith('Amazon'));
    const povFired = povMultiple != null && signals.some((s) => s.toLowerCase().includes('pov'));

    // Verdict title: "🔨 {tier} ends Xm - {set} - Bid £X (n bids) - {metric}, {PLAY}"
    let titleMetric: string;
    if (conditionMode === 'used') {
      titleMetric = `COG: ${povMultiple != null ? povMultiple.toFixed(1) : '?'}X, USED PART OUT`;
    } else if (amazonFired) {
      titleMetric = `Profit %: ${marginPercent!.toFixed(1)}, AMAZON SELL${povFired ? ' + PART OUT' : ''}`;
    } else {
      titleMetric = `COG: ${povMultiple != null ? povMultiple.toFixed(1) : '?'}X, NEW PART OUT`;
    }
    const embedTitle = `🔨 ${tierEmoji} ends ${minutesRemaining}m - ${setLabel} - Bid £${currentBid.toFixed(2)} (${bidCount} bid${bidCount !== 1 ? 's' : ''}) - ${titleMetric}`.substring(0, 256);

    // Auctions are time-critical: bid ceiling up front.
    const usedMaxBid =
      conditionMode === 'used' && maxBid == null && povSoldGbp != null
        ? Math.max(0, povSoldGbp / 3 - postage)
        : null;
    const actionBid = maxBid ?? usedMaxBid;

    const fields: DiscordEmbedField[] = [];

    fields.push({
      name: '⏰ Auction',
      value: `ends **${minutesRemaining} min** · ${bidCount} bid${bidCount !== 1 ? 's' : ''}`,
      inline: true,
    });
    if (actionBid != null) {
      fields.push({ name: '🎯 Max Bid', value: `**£${actionBid.toFixed(2)}**`, inline: true });
    }
    fields.push({
      name: '🏷️ eBay (COG)',
      value: `£${currentBid.toFixed(2)} + £${postage.toFixed(2)} post\n**Total: £${totalCost.toFixed(2)}**`,
      inline: true,
    });

    if (amazonPrice != null) {
      const amazonUrl = amazonAsin ? `https://www.amazon.co.uk/dp/${amazonAsin}` : null;
      const keepaUrl = amazonAsin ? `https://keepa.com/#!product/2-${amazonAsin}` : null;
      fields.push({
        name: '🛒 Amazon BB',
        value: `${amazonUrl ? `[£${amazonPrice.toFixed(2)}](${amazonUrl})` : `£${amazonPrice.toFixed(2)}`}${keepaUrl ? `\n[Keepa](${keepaUrl})` : ''}`,
        inline: true,
      });
      if (ukRrp) fields.push({ name: '🏷️ UK RRP', value: `£${ukRrp.toFixed(2)}`, inline: true });
      if (amazon90dAvg) fields.push({ name: '📊 90d Avg', value: `£${amazon90dAvg.toFixed(2)}`, inline: true });
      if (salesRank) fields.push({ name: '📈 BSR', value: formatSalesRank(salesRank), inline: true });
      if (profit != null && marginPercent != null) {
        fields.push({
          name: `${amazonFired ? '→ ' : ''}💰 Amazon Profit / Margin`,
          value: `Profit: **£${profit.toFixed(2)}** (${marginPercent.toFixed(1)}%)${roiPercent != null ? ` · ${roiPercent.toFixed(0)}% ROI` : ''}\nCOG: ${((totalCost / amazonPrice) * 100).toFixed(1)}%`,
          inline: false,
        });
      }
    } else if (ukRrp) {
      fields.push({ name: '🏷️ UK RRP', value: `£${ukRrp.toFixed(2)}`, inline: true });
    }

    const povLabel = conditionMode === 'used' ? 'Part-Out (Used)' : 'Part-Out (New)';
    if (povSoldGbp != null) {
      const meta: string[] = [];
      if (povMultiple != null) meta.push(`**${povMultiple.toFixed(1)}× cost**${!povFired ? ' (below the part-out bar)' : ''}`);
      if (povLots != null) meta.push(`${povLots} lots`);
      const povValueLines = [
        `6mo sold: **£${povSoldGbp.toFixed(2)}**${povForSaleGbp != null ? ` · for-sale: £${povForSaleGbp.toFixed(2)}` : ''}${meta.length ? `\n${meta.join(' · ')}` : ''}`,
      ];
      // Thin used history — show the deep NEW figure as the sanity anchor.
      if (conditionMode === 'used' && altNewPovSoldGbp != null && flags.some((f) => f.includes('thin used-parts history'))) {
        povValueLines.push(`New part-out (deeper data): £${altNewPovSoldGbp.toFixed(2)} · ${(altNewPovSoldGbp / totalCost).toFixed(1)}× cost`);
      }
      fields.push({
        name: `${povFired ? '→ ' : ''}🧩 ${povLabel}`,
        value: povValueLines.join('\n'),
        inline: false,
      });
    } else {
      fields.push({ name: `🧩 ${povLabel}`, value: 'no BL part-out data', inline: false });
    }

    if (flags.length > 0) {
      fields.push({
        name: '⚠️ Check before bidding',
        value: flags.map((f) => `• ${f}`).join('\n').slice(0, 1000),
        inline: false,
      });
    }

    fields.push({
      name: '🧱 Listing',
      value: `${ebayTitle.substring(0, 150)}`,
      inline: false,
    });

    const embed: DiscordEmbed = {
      title: embedTitle,
      url: ebayUrl,
      color,
      fields,
    };

    if (imageUrl) {
      (embed as Record<string, unknown>).thumbnail = { url: imageUrl };
    }

    return this.send('opportunities', embed);
  }

  /**
   * Send an eBay BIN part-out opportunity alert.
   *
   * Card contract (explicitness): every card answers WHAT is the play,
   * WHERE is the value, and WHAT to do — before any supporting detail.
   */
  async sendEbayBinPartoutAlert(params: EbayBinPartoutAlertParams): Promise<DiscordSendResult> {
    const {
      conditionMode = 'used',
      sets, title, priceGbp, postageGbp, totalCostGbp, povTotal, multiple, tier,
      realisablePovGbp = null, povCaptureRate = null,
      amazonPriceGbp, amazonProfitGbp, amazonMarginPct, amazon90dGbp, salesRank, asin, signals = [],
      bestOfferEnabled, offerSuggestionGbp, flags, sellerUsername, sellerScore,
      itemUrl, imageUrl, condition,
    } = params;

    const color = tier === 'great' ? 0x2ecc71 : 0xf1c40f;
    const tierEmoji = tier === 'great' ? '🟢' : '🟠';
    const primary = sets[0];
    // BL cache set names usually embed the set number ("75137 Carbon-Freezing
    // Chamber") — strip it so the label doesn't read "75137 75137 …".
    const primaryName = primary.setName
      ? primary.setName.replace(new RegExp(`^${primary.setNumber}\\s*`), '')
      : null;
    const setLabel =
      sets.length === 1
        ? `${primary.setNumber}${primaryName ? ` ${primaryName}` : ''}`
        : sets.map((s) => s.setNumber).join(' + ');

    const amazonFired = amazonMarginPct != null && signals.some((s) => s.startsWith('Amazon'));
    const povFired = multiple != null && signals.some((s) => s.includes('part-out'));

    // Verdict title: "{emoji} {tier} BIN {set} - {condition} - Price: £X - {metric}, {PLAY}"
    let titleMetric: string;
    if (amazonFired) {
      titleMetric = `Profit %: ${amazonMarginPct!.toFixed(1)}, AMAZON SELL${povFired ? ' + PART OUT' : ''}`;
    } else {
      titleMetric = `COG: ${multiple != null ? multiple.toFixed(1) : '?'}X, ${conditionMode === 'new' ? 'NEW' : 'USED'} PART OUT`;
    }
    const playEmoji = amazonFired ? '🛒' : '🧩';
    const embedTitle = `${playEmoji} ${tierEmoji} BIN ${setLabel} - ${condition ?? (conditionMode === 'new' ? 'New' : 'Used')} - Price: £${totalCostGbp.toFixed(2)} - ${titleMetric}`.substring(0, 256);

    const fields: DiscordEmbedField[] = [];

    fields.push({
      name: '🏷️ eBay (COG)',
      value: `£${priceGbp.toFixed(2)} + £${postageGbp.toFixed(2)} post\n**Total: £${totalCostGbp.toFixed(2)}**`,
      inline: true,
    });
    if (amazonPriceGbp != null) {
      const amazonUrl = asin ? `https://www.amazon.co.uk/dp/${asin}` : null;
      const keepaUrl = asin ? `https://keepa.com/#!product/2-${asin}` : null;
      fields.push({
        name: '🛒 Amazon BB',
        value: `${amazonUrl ? `[£${amazonPriceGbp.toFixed(2)}](${amazonUrl})` : `£${amazonPriceGbp.toFixed(2)}`}${keepaUrl ? `\n[Keepa](${keepaUrl})` : ''}`,
        inline: true,
      });
    }
    if (primary.rrpGbp) fields.push({ name: '🏷️ UK RRP', value: `£${primary.rrpGbp.toFixed(2)}`, inline: true });
    if (amazon90dGbp != null) fields.push({ name: '📊 90d Avg', value: `£${amazon90dGbp.toFixed(2)}`, inline: true });
    if (salesRank != null) fields.push({ name: '📈 BSR', value: salesRank.toLocaleString(), inline: true });

    if (amazonPriceGbp != null && amazonMarginPct != null) {
      const fees = amazonPriceGbp * 0.1836;
      const ship = amazonPriceGbp < 20 ? 3 : 4;
      fields.push({
        name: `${amazonFired ? '→ ' : ''}💰 Amazon Profit / Margin`,
        value: `Profit: **£${(amazonProfitGbp ?? 0).toFixed(2)}** (${amazonMarginPct.toFixed(1)}%)\nCOG: ${((totalCostGbp / amazonPriceGbp) * 100).toFixed(1)}% | Fees: £${fees.toFixed(2)} | Ship: £${ship}`,
        inline: false,
      });
    }

    if (povTotal > 0) {
      const povLines = [
        `6mo sold: **£${povTotal.toFixed(2)}**${multiple != null ? ` · **${multiple.toFixed(1)}× cost**${!povFired ? ' (below the part-out bar)' : ''}` : ''}`,
      ];
      const ctx: string[] = [];
      if (sets.length === 1) {
        if (primary.rrpGbp) ctx.push(`${((conditionMode === 'used' ? primary.usedPovGbp : (primary.newPovGbp ?? povTotal)) / primary.rrpGbp).toFixed(1)}× RRP`);
        if (conditionMode === 'used' && primary.figSharePct != null) ctx.push(`figs ≈ ${primary.figSharePct.toFixed(0)}%`);
        if (conditionMode === 'used' && primary.ebayFloorGbp != null) ctx.push(`typical eBay used ask: £${primary.ebayFloorGbp.toFixed(2)}`);
      }
      if (ctx.length) povLines.push(ctx.join(' · '));
      // Realisable (liquidity-adjusted) POV — only shown when we have a genuine
      // set-level STR signal (spec §3 F4); flag-don't-suppress means add the honest
      // number when we have one, never fabricate one when the signal is absent.
      if (realisablePovGbp != null) {
        const capturePct = povCaptureRate != null ? Math.round(povCaptureRate * 100) : null;
        povLines.push(
          `Realisable (est): **£${realisablePovGbp.toFixed(2)}**${capturePct != null ? ` · ${capturePct}% capture` : ''}`
        );
      }
      // Thin used history -> the deep NEW figure is the sanity anchor; show both.
      const thinFlagged = flags.some((f) => f.includes('thin used-parts history'));
      if (conditionMode === 'used' && thinFlagged) {
        const newTotal = sets.reduce((a, st) => a + (st.newPovGbp ?? 0), 0);
        if (newTotal > 0) {
          povLines.push(`New part-out (deeper data): £${newTotal.toFixed(2)} · ${(newTotal / totalCostGbp).toFixed(1)}× cost`);
        }
      }
      fields.push({
        name: `${povFired ? '→ ' : ''}🧩 Part-Out (${conditionMode === 'new' ? 'New' : 'Used'})`,
        value: povLines.join('\n'),
        inline: false,
      });
    }

    if (bestOfferEnabled) {
      fields.push({
        name: '🤝 Best Offer',
        value: offerSuggestionGbp != null
          ? `offer **£${offerSuggestionGbp.toFixed(2)}** → hits the bar`
          : 'enabled — already over the bar at asking',
        inline: true,
      });
    }

    if (flags.length > 0) {
      fields.push({
        name: '⚠️ Check before buying',
        value: flags.map((f) => `• ${f}`).join('\n').slice(0, 1000),
        inline: false,
      });
    }

    fields.push({
      name: '🧱 Listing',
      value:
        `${title.slice(0, 150)}\n` +
        `Condition: ${condition ?? 'Used'} · Seller: ${sellerUsername ?? '?'}${sellerScore != null ? ` (${sellerScore})` : ''}`,
      inline: false,
    });

    const embed: DiscordEmbed = {
      title: embedTitle,
      url: itemUrl,
      color,
      fields,
    };
    if (imageUrl) {
      (embed as Record<string, unknown>).thumbnail = { url: imageUrl };
    }

    return this.send('opportunities', embed);
  }

  /**
   * Send a PG canary cross-lane divergence alert (spec §4.4: golden-tuple canary set
   * fetched via every active lane daily; alert on >5% divergence between lanes — the
   * defence against parse drift, FX drift, and BL format changes going unnoticed).
   */
  async sendPgCanaryAlert(params: PgCanaryAlertParams): Promise<DiscordSendResult> {
    const { runDate, divergentCount, totalTuples, divergences } = params;

    const fields: DiscordEmbedField[] = [
      {
        name: '📊 Summary',
        value: `**${divergentCount}/${totalTuples}** golden tuples diverged >5% between lanes on ${runDate}`,
        inline: false,
      },
    ];

    const shown = divergences.slice(0, 10);
    if (shown.length > 0) {
      const lines = shown.map((d) => {
        const laneStr = Object.entries(d.lanes)
          .map(([lane, val]) => `${lane}=${val != null ? `£${val.toFixed(3)}` : 'n/a'}`)
          .join(' · ');
        return `• **${d.label}**: ${laneStr} (${d.maxDivergencePct.toFixed(1)}%)`;
      });
      fields.push({
        name: `⚠️ Divergent tuples (top ${shown.length})`,
        value: lines.join('\n').slice(0, 1000),
        inline: false,
      });
    }

    const embed: DiscordEmbed = {
      title: '🐤 PG Canary: cross-lane price divergence',
      description: 'Golden-tuple prices disagree by more than 5% between two or more BrickLink acquisition lanes — check for parse drift, FX drift, or a BL page/API format change.',
      color: DiscordColors.RED,
      fields,
    };

    return this.send('alerts', embed);
  }

  /**
   * PG ops threshold alert (spec §5.4): fired by the nightly refresh cycle when a
   * lane trips its rate-discipline thresholds (e.g. >=2 blocked lane D sessions in
   * one night). Incident-shaped -> alerts channel.
   */
  async sendPgOpsAlert(params: { title: string; lines: string[] }): Promise<DiscordSendResult> {
    const embed: DiscordEmbed = {
      title: `🛠️ PG ops: ${params.title}`,
      description: params.lines.join('\n').slice(0, 4000),
      color: DiscordColors.RED,
    };
    return this.send('alerts', embed);
  }

  /**
   * Send the weekly PG market intelligence digest (spec §5.3): top STR risers/fallers,
   * fig-radar movers, own-store audit top-5s, and coverage/freshness health. Reuses the
   * daily-summary channel — this is a scheduled report, not an incident alert.
   *
   * Discord embed `description` has a hard 4096-char limit; the digest body is built as
   * one markdown blob and truncated gracefully (with a visible "…truncated" marker) if a
   * busy week's content would overflow it, rather than erroring or dropping sections
   * silently.
   */
  async sendPgDigest(params: PgDigestAlertParams): Promise<DiscordSendResult> {
    const { runDate, strRisers, strFallers, figMovers, coverage, ownStoreAuditExcerpts, reportPath } = params;

    const moverLine = (m: PgDigestMoverRow) =>
      `• **${m.label}**: ${m.qtyDelta > 0 ? '+' : ''}${m.qtyDelta} qty (STR ${m.latestStrNew?.toFixed(2) ?? '—'}/${m.latestStrUsed?.toFixed(2) ?? '—'})`;

    const sections: string[] = [];

    sections.push(`**📈 STR risers (top ${Math.min(10, strRisers.length)})**`);
    sections.push(strRisers.length > 0 ? strRisers.slice(0, 10).map(moverLine).join('\n') : '_None this week._');

    sections.push('', `**📉 STR fallers (top ${Math.min(10, strFallers.length)})**`);
    sections.push(strFallers.length > 0 ? strFallers.slice(0, 10).map(moverLine).join('\n') : '_None this week._');

    sections.push('', `**🧍 Fig radar movers (top ${Math.min(10, figMovers.length)})**`);
    sections.push(figMovers.length > 0 ? figMovers.slice(0, 10).map(moverLine).join('\n') : '_None this week._');

    sections.push(
      '',
      '**🩺 Coverage & freshness**',
      `L1 total: **${coverage.l1Total.toLocaleString()}** · Active tier: **${coverage.activeTierCount.toLocaleString()}** · covered+fresh: **${coverage.activeCoveredFreshPct.toFixed(1)}%** · UK-sold yield: **${coverage.activeUkSoldPct.toFixed(1)}%** · never scraped: **${coverage.activeNeverScraped.toLocaleString()}** · stale: **${coverage.staleCount.toLocaleString()}** · past due: **${coverage.pastDueCount.toLocaleString()}**`,
      `Queue grew **+${coverage.growth7d.total.toLocaleString()}** (7d): ${coverage.growth7d.storeDiscovered.toLocaleString()} store-discovered · ${coverage.growth7d.newRelease.toLocaleString()} new-release · ${coverage.growth7d.backfill.toLocaleString()} backfill`,
    );
    if (coverage.laneTelemetry.length > 0) {
      sections.push(
        ...coverage.laneTelemetry.map(
          (l) => `• **${l.lane}** (7d): ${l.requests7d} req, ${l.ok7d} ok / ${l.failed7d} failed — first-403 trend: ${l.firstBlockTrend}`,
        ),
      );
    }

    if (ownStoreAuditExcerpts.length > 0) {
      sections.push('', '**🏪 Own-store audit (most recent, last 7d)**');
      for (const excerpt of ownStoreAuditExcerpts) {
        sections.push(`_${excerpt.title}_`, ...(excerpt.lines.length > 0 ? excerpt.lines.slice(0, 5) : ['_None._']));
      }
    } else {
      sections.push('', '**🏪 Own-store audit**', '_No audit report from the last 7 days._');
    }

    sections.push('', `Full report: \`${reportPath}\``);

    let description = sections.join('\n');
    const DESCRIPTION_LIMIT = 4096;
    if (description.length > DESCRIPTION_LIMIT) {
      const marker = '\n\n_…truncated — see full report on disk._';
      description = description.slice(0, DESCRIPTION_LIMIT - marker.length) + marker;
    }

    const embed: DiscordEmbed = {
      title: `📊 PG weekly market digest — ${runDate}`,
      description,
      color: DiscordColors.BLUE,
    };

    return this.send('daily-summary', embed);
  }

  /**
   * Send a joblot opportunity alert.
   */
  async sendEbayJoblotAlert(params: EbayJoblotAlertParams): Promise<DiscordSendResult> {
    const {
      ebayTitle, currentBid, postage, totalCost, bidCount, minutesRemaining,
      totalAmazonValue, estimatedProfit, marginPercent, sets, ebayUrl, imageUrl,
    } = params;

    const color = marginPercent >= 30 ? 0x2ecc71 : 0xf1c40f;
    const setsBreakdown = sets
      .map((s) => {
        const price = s.amazonPrice ? `£${s.amazonPrice.toFixed(2)}` : '?';
        return `• ${s.setNumber}${s.setName ? ` ${s.setName}` : ''} → ${price}`;
      })
      .join('\n');

    const fields: DiscordEmbedField[] = [
      {
        name: '🏷️ eBay (COG)',
        value: `Bid: £${currentBid.toFixed(2)} + £${postage.toFixed(2)} post\n**Total: £${totalCost.toFixed(2)}**`,
        inline: true,
      },
      {
        name: '🛒 Total Amazon Value',
        value: `**£${totalAmazonValue.toFixed(2)}**`,
        inline: true,
      },
      {
        name: '⏰ Time Left',
        value: `${minutesRemaining} min · ${bidCount} bid${bidCount !== 1 ? 's' : ''}`,
        inline: true,
      },
      {
        name: '💰 Est. Profit / Margin',
        value: `**£${estimatedProfit.toFixed(2)}** · ${marginPercent.toFixed(1)}% margin`,
        inline: false,
      },
      {
        name: `📦 Sets (${sets.length})`,
        value: setsBreakdown.substring(0, 1024),
        inline: false,
      },
    ];

    const embed: DiscordEmbed = {
      title: `📦 JOBLOT: ${ebayTitle.substring(0, 70)}`,
      url: ebayUrl,
      color,
      fields,
    };

    if (imageUrl) {
      (embed as Record<string, unknown>).thumbnail = { url: imageUrl };
    }

    return this.send('opportunities', embed);
  }
}

export const discordService = new DiscordService();
