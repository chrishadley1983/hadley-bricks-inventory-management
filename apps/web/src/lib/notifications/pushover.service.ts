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
}

export const pushoverService = new PushoverService();
