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

export interface VintedOpportunityParams {
  setNumber: string;
  setName: string;
  vintedPrice: number;
  amazonPrice: number;
  cogPercent: number;
  profit: number;
  vintedUrl: string;
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
  amazonPrice: number;
  amazon90dAvg: number | null;
  amazonAsin: string;
  salesRank: number | null;
  profit: number;
  marginPercent: number;
  roiPercent: number;
  alertTier: 'great' | 'good';
  ebayUrl: string;
  imageUrl: string | null;
  ukRrp: number | null;
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

export interface VintedDailySummaryParams {
  broadSweeps: number;
  watchlistScans: number;
  opportunitiesFound: number;
  nearMissesFound: number;
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
  private readonly webhooks: Record<DiscordChannel, string | undefined>;
  private readonly appUrl: string;
  private readonly timeout = 5000; // 5 second timeout

  constructor() {
    this.webhooks = {
      alerts: process.env.DISCORD_WEBHOOK_ALERTS,
      opportunities: process.env.DISCORD_WEBHOOK_OPPORTUNITIES,
      'sync-status': process.env.DISCORD_WEBHOOK_SYNC_STATUS,
      'daily-summary': process.env.DISCORD_WEBHOOK_DAILY_SUMMARY,
      'peter-chat': process.env.DISCORD_WEBHOOK_PETER_CHAT,
    };
    this.appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    // Log configuration status on instantiation
    const configuredChannels = Object.entries(this.webhooks)
      .filter(([, url]) => !!url)
      .map(([channel]) => channel);
    const missingChannels = Object.entries(this.webhooks)
      .filter(([, url]) => !url)
      .map(([channel]) => channel);

    if (configuredChannels.length > 0) {
      console.log(`[DiscordService] Configured channels: ${configuredChannels.join(', ')}`);
    }
    if (missingChannels.length > 0) {
      console.log(`[DiscordService] Missing channels: ${missingChannels.join(', ')}`);
    }
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
      console.log(`[DiscordService] Channel ${channel} not configured - skipping`);
      return { success: true }; // Silent skip if not configured
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
   * Send Vinted opportunity alert
   * SendsendVintedOpportunity
   */
  async sendVintedOpportunity(params: VintedOpportunityParams): Promise<void> {
    await this.sendOpportunity(params);
  }

  /**
   * Send CAPTCHA warning - scanner has been auto-paused
   * SendsendVintedCaptchaWarning
   */
  async sendVintedCaptchaWarning(): Promise<void> {
    await this.sendAlert({
      title: '⚠️ CAPTCHA Detected - Scanner Paused',
      message:
        'Vinted CAPTCHA detected. Scanner has been automatically paused. ' +
        'Please resolve the CAPTCHA manually and resume scanning.',
      priority: 'high',
      url: `${this.appUrl}/arbitrage/vinted/automation`,
      urlTitle: 'View Scanner Status',
    });
  }

  /**
   * Send daily summary of Vinted scanner activity
   * SendsendVintedDailySummary
   */
  async sendVintedDailySummary(params: VintedDailySummaryParams): Promise<void> {
    const { broadSweeps, watchlistScans, opportunitiesFound, nearMissesFound } = params;

    await this.sendDailySummary({
      title: '📊 Vinted Scanner Daily Summary',
      fields: [
        { name: 'Broad Sweeps', value: broadSweeps.toString(), inline: true },
        { name: 'Watchlist Scans', value: watchlistScans.toString(), inline: true },
        { name: 'Opportunities', value: opportunitiesFound.toString(), inline: true },
        { name: 'Near Misses', value: nearMissesFound.toString(), inline: true },
      ],
    });
  }

  /**
   * Send consecutive failure alert
   * SendsendVintedConsecutiveFailures
   */
  async sendVintedConsecutiveFailures(failureCount: number): Promise<void> {
    await this.sendAlert({
      title: '🔴 Vinted Scanner Issues',
      message:
        `${failureCount} consecutive scan failures detected.\n` +
        'Please check scanner status and Vinted accessibility.',
      priority: 'high',
      url: `${this.appUrl}/arbitrage/vinted/automation`,
      urlTitle: 'View Scanner Status',
    });
  }

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
   * Colour-coded: green for great deals (≥25% margin), amber for good deals (≥15%).
   */
  async sendEbayAuctionAlert(params: EbayAuctionAlertParams): Promise<DiscordSendResult> {
    const {
      setNumber, setName, ebayTitle, currentBid, postage, totalCost,
      bidCount, minutesRemaining, amazonPrice, amazon90dAvg, amazonAsin,
      salesRank, profit, marginPercent, roiPercent, alertTier,
      ebayUrl, imageUrl, ukRrp,
    } = params;

    const color = alertTier === 'great' ? 0x2ecc71 : 0xf1c40f; // Green or amber
    const tierEmoji = alertTier === 'great' ? '🟢' : '🟠';
    const tierLabel = alertTier === 'great' ? 'GREAT DEAL' : 'GOOD DEAL';

    const keepaUrl = `https://keepa.com/#!product/2-${amazonAsin}`;
    const amazonUrl = `https://www.amazon.co.uk/dp/${amazonAsin}`;

    const fields: DiscordEmbedField[] = [
      {
        name: '🏷️ eBay (COG)',
        value: `Bid: £${currentBid.toFixed(2)} + £${postage.toFixed(2)} post\n**Total: £${totalCost.toFixed(2)}**`,
        inline: true,
      },
      {
        name: '🛒 Amazon',
        value: `Buy Box: [£${amazonPrice.toFixed(2)}](${amazonUrl})\n[Keepa](${keepaUrl})`,
        inline: true,
      },
      {
        name: '📊 90d Avg',
        value: amazon90dAvg ? `£${amazon90dAvg.toFixed(2)}` : '—',
        inline: true,
      },
      {
        name: '💰 Profit / Margin',
        value: `**£${profit.toFixed(2)}** · ${marginPercent.toFixed(1)}% margin · ${roiPercent.toFixed(0)}% ROI`,
        inline: false,
      },
      {
        name: `${tierEmoji} ${tierLabel}`,
        value: `${marginPercent.toFixed(1)}% profit margin`,
        inline: true,
      },
      {
        name: '⏰ Time Left',
        value: `${minutesRemaining} min · ${bidCount} bid${bidCount !== 1 ? 's' : ''}`,
        inline: true,
      },
    ];

    if (ukRrp) {
      fields.push({ name: '🏷️ UK RRP', value: `£${ukRrp.toFixed(2)}`, inline: true });
    }

    if (salesRank) {
      fields.push({
        name: '📈 Sales Rank',
        value: `#${new Intl.NumberFormat('en-GB').format(salesRank)}`,
        inline: true,
      });
    }

    fields.push({
      name: '🧱 Set',
      value: `${setNumber}${setName ? `: ${setName}` : ''}`,
      inline: false,
    });

    const embed: DiscordEmbed = {
      title: `🔨 ${setNumber}: ${ebayTitle.substring(0, 80)}`,
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
   * Send a joblot opportunity alert.
   */
  async sendEbayJoblotAlert(params: EbayJoblotAlertParams): Promise<DiscordSendResult> {
    const {
      ebayTitle, currentBid, postage, totalCost, bidCount, minutesRemaining,
      totalAmazonValue, estimatedProfit, marginPercent, sets, ebayUrl, imageUrl,
    } = params;

    const color = marginPercent >= 25 ? 0x2ecc71 : 0xf1c40f;
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
