/**
 * Pushover Notification Service
 *
 * Sends instant push notifications for business-critical events.
 * Works with Pushover desktop (free) and mobile app (£5 one-time).
 *
 * Setup:
 * 1. Create account at https://pushover.net/
 * 2. Get your User Key from the dashboard
 * 3. Create an Application and get API Token
 * 4. Download desktop client: https://pushover.net/clients/desktop
 * 5. Optional: Buy mobile app (£5) for phone notifications
 *
 * @see https://pushover.net/api
 */

interface PushoverMessage {
  message: string;
  title?: string;
  /** Priority: -2 (lowest) to 2 (emergency). Default: 0 (normal) */
  priority?: -2 | -1 | 0 | 1 | 2;
  /** URL to include in the notification */
  url?: string;
  /** Title for the URL */
  urlTitle?: string;
  /** Notification sound (see Pushover docs for options) */
  sound?: string;
}

interface PushoverResponse {
  status: number;
  request: string;
  errors?: string[];
}

export interface SyncFailureParams {
  feedId: string;
  itemCount: number;
  reason: string;
  phase: 'price_verification' | 'price_rejected' | 'quantity_rejected';
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

export interface VintedDailySummaryParams {
  broadSweeps: number;
  watchlistScans: number;
  opportunitiesFound: number;
  nearMissesFound: number;
}

export class PushoverService {
  private readonly apiUrl = 'https://api.pushover.net/1/messages.json';
  private readonly userKey: string;
  private readonly apiToken: string;
  private readonly enabled: boolean;

  constructor() {
    this.userKey = process.env.PUSHOVER_USER_KEY || '';
    this.apiToken = process.env.PUSHOVER_API_TOKEN || '';
    this.enabled = !!(this.userKey && this.apiToken);

    if (!this.enabled) {
      console.log(
        '[PushoverService] Disabled - missing PUSHOVER_USER_KEY or PUSHOVER_API_TOKEN'
      );
    }
  }

  /**
   * Check if Pushover is configured and enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Send a push notification via Pushover
   */
  async send(params: PushoverMessage): Promise<{ success: boolean; error?: string }> {
    if (!this.enabled) {
      console.log('[PushoverService] Skipping - not configured');
      return { success: true }; // Silent skip if not configured
    }

    try {
      const body = new URLSearchParams({
        token: this.apiToken,
        user: this.userKey,
        message: params.message,
        ...(params.title && { title: params.title }),
        ...(params.priority !== undefined && { priority: params.priority.toString() }),
        ...(params.url && { url: params.url }),
        ...(params.urlTitle && { url_title: params.urlTitle }),
        ...(params.sound && { sound: params.sound }),
      });

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      const data: PushoverResponse = await response.json();

      if (data.status !== 1) {
        console.error('[PushoverService] Failed:', data.errors);
        return { success: false, error: data.errors?.join(', ') || 'Unknown error' };
      }

      console.log('[PushoverService] Notification sent:', data.request);
      return { success: true };
    } catch (err) {
      console.error('[PushoverService] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  /**
   * Send two-phase sync failure notification
   */
  async sendSyncFailure(params: SyncFailureParams): Promise<void> {
    const { feedId, itemCount, reason, phase } = params;

    const phaseLabels = {
      price_verification: 'Price verification timeout',
      price_rejected: 'Price feed rejected',
      quantity_rejected: 'Quantity feed rejected',
    };

    await this.send({
      title: '⚠️ Amazon Sync Failed',
      message: `${phaseLabels[phase]}: ${reason}\n${itemCount} item(s) affected`,
      priority: 1, // High priority - will play sound/vibrate
      url: `${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}`,
      urlTitle: 'View Feed Details',
      sound: 'siren', // Urgent sound for failures
    });
  }

  /**
   * Send two-phase sync success notification
   */
  async sendSyncSuccess(params: SyncSuccessParams): Promise<void> {
    const { feedId, itemCount, verificationTime } = params;
    const timeStr =
      verificationTime > 60000
        ? `${Math.round(verificationTime / 60000)} min`
        : `${Math.round(verificationTime / 1000)} sec`;

    await this.send({
      title: '✅ Amazon Sync Complete',
      message: `${itemCount} item(s) synced successfully\nPrice verified in ${timeStr}`,
      priority: 0, // Normal priority
      url: `${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}`,
      urlTitle: 'View Feed Details',
    });
  }

  // =========================================================================
  // Vinted Arbitrage Notifications
  // =========================================================================

  /**
   * Send Vinted opportunity alert
   * Uses high priority (1) for excellent deals (<30% COG)
   */
  async sendVintedOpportunity(params: VintedOpportunityParams): Promise<void> {
    const { setNumber, setName, vintedPrice, amazonPrice, cogPercent, profit, vintedUrl } =
      params;

    // High priority for excellent opportunities (<30% COG)
    const priority = cogPercent < 30 ? 1 : 0;

    await this.send({
      title: `🎯 ${setNumber}: ${cogPercent.toFixed(0)}% COG`,
      message:
        `${setName}\n` +
        `Vinted: £${vintedPrice.toFixed(2)}\n` +
        `Amazon: £${amazonPrice.toFixed(2)}\n` +
        `Profit: £${profit.toFixed(2)}`,
      priority: priority as 0 | 1,
      url: vintedUrl,
      urlTitle: 'View on Vinted',
      sound: priority === 1 ? 'cashregister' : 'pushover',
    });
  }

  /**
   * Send CAPTCHA warning - scanner has been auto-paused
   */
  async sendVintedCaptchaWarning(): Promise<void> {
    await this.send({
      title: '⚠️ CAPTCHA Detected - Scanner Paused',
      message:
        'Vinted CAPTCHA detected. Scanner has been automatically paused. ' +
        'Please resolve the CAPTCHA manually and resume scanning.',
      priority: 1,
      url: `${process.env.NEXT_PUBLIC_APP_URL}/arbitrage/vinted/automation`,
      urlTitle: 'View Scanner Status',
      sound: 'siren',
    });
  }

  /**
   * Send daily summary of Vinted scanner activity
   */
  async sendVintedDailySummary(params: VintedDailySummaryParams): Promise<void> {
    const { broadSweeps, watchlistScans, opportunitiesFound, nearMissesFound } = params;

    await this.send({
      title: '📊 Vinted Scanner Daily Summary',
      message:
        `Broad sweeps: ${broadSweeps}\n` +
        `Watchlist scans: ${watchlistScans}\n` +
        `Opportunities: ${opportunitiesFound}\n` +
        `Near misses: ${nearMissesFound}`,
      priority: 0,
    });
  }

  /**
   * Send consecutive failure alert
   * Triggered after 3+ consecutive scan failures
   */
  async sendVintedConsecutiveFailures(failureCount: number): Promise<void> {
    await this.send({
      title: '🔴 Vinted Scanner Issues',
      message:
        `${failureCount} consecutive scan failures detected.\n` +
        'Please check scanner status and Vinted accessibility.',
      priority: 1,
      url: `${process.env.NEXT_PUBLIC_APP_URL}/arbitrage/vinted/automation`,
      urlTitle: 'View Scanner Status',
      sound: 'falling',
    });
  }
}

export const pushoverService = new PushoverService();
