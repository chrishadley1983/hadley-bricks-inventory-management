/**
 * Email Service
 *
 * Handles transactional email notifications for business-critical events.
 * Uses Resend for email delivery.
 *
 * @see https://resend.com/docs
 */

import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface TwoPhaseFailureParams {
  userEmail: string;
  feedId: string;
  failedSkus: string[];
  submittedPrice: number;
  verificationDuration: number;
  itemDetails: Array<{ sku: string; asin: string; setNumber: string; itemName: string }>;
}

export interface FeedRejectionParams {
  userEmail: string;
  feedId: string;
  phase: 'price' | 'quantity';
  errorMessage: string;
  errorCode?: string;
  itemDetails: Array<{ sku: string; asin: string; setNumber: string; itemName: string }>;
}

export interface TwoPhaseSuccessParams {
  userEmail: string;
  feedId: string;
  itemCount: number;
  priceVerificationTime: number;
  itemDetails: Array<{
    sku: string;
    asin: string;
    setNumber: string;
    itemName: string;
    price: number;
  }>;
}

export class EmailService {
  private defaultFrom = 'Hadley Bricks <onboarding@resend.dev>';
  private enabled: boolean;

  constructor() {
    this.enabled = !!resend;
    if (!this.enabled) {
      console.log('[EmailService] Disabled - missing RESEND_API_KEY');
    }
  }

  /**
   * Check if email service is configured
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Send an email
   */
  async send(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    if (!resend) {
      console.log('[EmailService] Skipping - not configured');
      return { success: true };
    }

    try {
      const { data, error } = await resend.emails.send({
        from: this.defaultFrom,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      if (error) {
        console.error('[EmailService] Failed to send email:', error);
        return { success: false, error: error.message };
      }

      console.log('[EmailService] Email sent:', data?.id);
      return { success: true };
    } catch (err) {
      console.error('[EmailService] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  /**
   * Send two-phase sync failure notification (price verification timeout)
   */
  async sendTwoPhaseFailure(params: TwoPhaseFailureParams): Promise<void> {
    const { userEmail, feedId, failedSkus, submittedPrice, verificationDuration, itemDetails } =
      params;

    const itemList = itemDetails
      .map((item) => `• ${item.setNumber} - ${item.itemName} (SKU: ${item.sku})`)
      .join('\n');

    const html = `
      <h2>⚠️ Amazon Two-Phase Sync Failed</h2>

      <p><strong>Price verification timed out after ${Math.round(verificationDuration / 60000)} minutes.</strong></p>

      <p>The price update was submitted but could not be verified as live on Amazon within the timeout period.
      <strong>Quantity has NOT been updated</strong> to prevent selling at the old price.</p>

      <h3>Affected Items:</h3>
      <pre>${itemList}</pre>

      <h3>Details:</h3>
      <ul>
        <li><strong>Feed ID:</strong> ${feedId}</li>
        <li><strong>Submitted Price:</strong> £${submittedPrice.toFixed(2)}</li>
        <li><strong>Failed SKUs:</strong> ${failedSkus.join(', ')}</li>
      </ul>

      <h3>Required Action:</h3>
      <ol>
        <li>Check Amazon Seller Central to verify if the price is now visible</li>
        <li>If price is correct, manually update quantity or retry sync</li>
        <li>If price is still old, investigate Amazon feed processing</li>
      </ol>

      <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}">View Feed Details</a></p>
    `;

    const text = `
Amazon Two-Phase Sync Failed

Price verification timed out after ${Math.round(verificationDuration / 60000)} minutes.

The price update was submitted but could not be verified as live on Amazon.
QUANTITY HAS NOT BEEN UPDATED to prevent selling at the old price.

Affected Items:
${itemList}

Details:
- Feed ID: ${feedId}
- Submitted Price: £${submittedPrice.toFixed(2)}
- Failed SKUs: ${failedSkus.join(', ')}

Required Action:
1. Check Amazon Seller Central to verify if the price is now visible
2. If price is correct, manually update quantity or retry sync
3. If price is still old, investigate Amazon feed processing

View Feed: ${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}
    `;

    await this.send({
      to: userEmail,
      subject: `⚠️ Amazon Sync Failed: Price verification timeout for ${failedSkus.length} item(s)`,
      html,
      text,
    });
  }

  /**
   * Send feed rejection failure notification
   * Used when Amazon rejects the price or quantity feed
   */
  async sendFeedRejectionFailure(params: FeedRejectionParams): Promise<void> {
    const { userEmail, feedId, phase, errorMessage, errorCode, itemDetails } = params;

    const itemList = itemDetails
      .map((item) => `• ${item.setNumber} - ${item.itemName} (SKU: ${item.sku})`)
      .join('\n');

    const phaseLabel = phase === 'price' ? 'Price' : 'Quantity';
    const consequence =
      phase === 'price'
        ? 'Neither price nor quantity has been updated.'
        : 'Price was updated but quantity was NOT updated.';

    const html = `
      <h2>❌ Amazon Two-Phase Sync Failed - ${phaseLabel} Feed Rejected</h2>

      <p><strong>Amazon rejected the ${phase} feed.</strong></p>

      <p>${consequence}</p>

      <h3>Error Details:</h3>
      <ul>
        <li><strong>Error:</strong> ${errorMessage}</li>
        ${errorCode ? `<li><strong>Code:</strong> ${errorCode}</li>` : ''}
      </ul>

      <h3>Affected Items:</h3>
      <pre>${itemList}</pre>

      <h3>Required Action:</h3>
      <ol>
        <li>Review the error message above</li>
        <li>Check Amazon Seller Central for additional details</li>
        <li>Fix the issue and retry the sync</li>
      </ol>

      <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}">View Feed Details</a></p>
    `;

    const text = `
Amazon Two-Phase Sync Failed - ${phaseLabel} Feed Rejected

Amazon rejected the ${phase} feed.

${consequence}

Error: ${errorMessage}
${errorCode ? `Code: ${errorCode}` : ''}

Affected Items:
${itemList}

Required Action:
1. Review the error message above
2. Check Amazon Seller Central for additional details
3. Fix the issue and retry the sync

View Feed: ${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}
    `;

    await this.send({
      to: userEmail,
      subject: `❌ Amazon Sync Failed: ${phaseLabel} feed rejected`,
      html,
      text,
    });
  }

  /**
   * Send two-phase sync success notification
   */
  async sendTwoPhaseSuccess(params: TwoPhaseSuccessParams): Promise<void> {
    const { userEmail, feedId, itemCount, priceVerificationTime, itemDetails } = params;

    const itemList = itemDetails
      .map((item) => `• ${item.setNumber} - ${item.itemName} @ £${item.price.toFixed(2)}`)
      .join('\n');

    const html = `
      <h2>✅ Amazon Two-Phase Sync Complete</h2>

      <p><strong>${itemCount} item(s) successfully synced to Amazon.</strong></p>

      <p>Price was verified live after ${Math.round(priceVerificationTime / 1000)} seconds,
      then quantity was updated.</p>

      <h3>Synced Items:</h3>
      <pre>${itemList}</pre>

      <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}">View Feed Details</a></p>
    `;

    await this.send({
      to: userEmail,
      subject: `✅ Amazon Sync Complete: ${itemCount} item(s) synced`,
      html,
    });
  }
}

export const emailService = new EmailService();
