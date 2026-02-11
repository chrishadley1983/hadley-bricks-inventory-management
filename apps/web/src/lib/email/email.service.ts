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

export interface PurchaseImportEmailItem {
  set_number: string;
  set_name: string;
  source: string;
  condition: string;
  cost: number;
  list_price: number | null;
  purchase_date: string;
  purchase_label: string; // e.g. "£18.89 Bundle" or "£11.23 (Vinted)" — only on first item per purchase
}

export interface PurchaseImportSummaryParams {
  userEmail: string;
  items: PurchaseImportEmailItem[];
  needsReview: Array<{ source: string; item_name: string; cost: number }>;
  duration: number;
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
  /**
   * Send purchase import summary email with profit analysis table
   */
  async sendPurchaseImportSummary(params: PurchaseImportSummaryParams): Promise<void> {
    const { userEmail, items, needsReview, duration } = params;

    if (items.length === 0) return;

    // Amazon FBM UK fee constants (self-contained, matches lib/arbitrage/calculations.ts)
    const EFFECTIVE_FEE_RATE = 0.15 * 1.02 * 1.20; // 18.36%
    const SHIPPING_THRESHOLD = 14.0;
    const SHIPPING_LOW = 3.0;
    const SHIPPING_HIGH = 4.0;

    // Calculate per-item metrics
    const rows = items.map((item) => {
      const listPrice = item.list_price;
      let cogPercent: number | null = null;
      let profit: number | null = null;
      let marginPercent: number | null = null;

      if (listPrice && listPrice > 0) {
        cogPercent = (item.cost / listPrice) * 100;
        const fees = listPrice * EFFECTIVE_FEE_RATE;
        const shipping = listPrice < SHIPPING_THRESHOLD ? SHIPPING_LOW : SHIPPING_HIGH;
        profit = listPrice - fees - shipping - item.cost;
        marginPercent = (profit / listPrice) * 100;
      }

      return { ...item, cogPercent, profit, marginPercent };
    });

    // Totals
    const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);
    const totalListValue = rows.reduce((sum, r) => sum + (r.list_price ?? 0), 0);
    const totalProfit = rows.reduce((sum, r) => sum + (r.profit ?? 0), 0);
    const overallCogPercent = totalListValue > 0 ? (totalCost / totalListValue) * 100 : null;
    const overallMarginPercent = totalListValue > 0 ? (totalProfit / totalListValue) * 100 : null;

    const fmt = (n: number) => `£${n.toFixed(2)}`;
    const pct = (n: number | null) => (n !== null ? `${n.toFixed(1)}%` : '-');

    // Build HTML table rows
    const tableRows = rows
      .map((r) => {
        const profitColor =
          r.profit !== null ? (r.profit >= 0 ? '#27ae60' : '#e74c3c') : '#888';
        return `<tr>
          <td style="padding:6px 10px;border:1px solid #ddd;white-space:nowrap;">${r.purchase_label}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;white-space:nowrap;">${r.purchase_date}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;">${r.set_number}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;">${r.set_name}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;">${r.condition}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${fmt(r.cost)}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${r.list_price ? fmt(r.list_price) : '-'}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${pct(r.cogPercent)}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;color:${profitColor};">${r.profit !== null ? fmt(r.profit) : '-'}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;color:${profitColor};">${pct(r.marginPercent)}</td>
        </tr>`;
      })
      .join('\n');

    // Totals row
    const totalProfitColor = totalProfit >= 0 ? '#27ae60' : '#e74c3c';
    const totalsRow = `<tr style="font-weight:bold;background:#f0f0f0;">
      <td style="padding:6px 10px;border:1px solid #ddd;" colspan="5">Totals (${items.length} items)</td>
      <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${fmt(totalCost)}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${totalListValue > 0 ? fmt(totalListValue) : '-'}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${pct(overallCogPercent)}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;color:${totalProfitColor};">${fmt(totalProfit)}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;color:${totalProfitColor};">${pct(overallMarginPercent)}</td>
    </tr>`;

    // Needs review section
    let reviewSection = '';
    if (needsReview.length > 0) {
      const reviewRows = needsReview
        .map(
          (r) =>
            `<tr>
            <td style="padding:4px 8px;border:1px solid #ddd;">${r.source}</td>
            <td style="padding:4px 8px;border:1px solid #ddd;">${r.item_name}</td>
            <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmt(r.cost)}</td>
          </tr>`
        )
        .join('\n');

      reviewSection = `
        <h3 style="color:#e67e22;margin-top:24px;">⚠️ Needs Review (${needsReview.length})</h3>
        <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;width:100%;">
          <thead>
            <tr style="background:#fef3e2;">
              <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Source</th>
              <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Item</th>
              <th style="padding:6px 8px;border:1px solid #ddd;text-align:right;">Cost</th>
            </tr>
          </thead>
          <tbody>${reviewRows}</tbody>
        </table>
      `;
    }

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;">
        <h2 style="color:#333;">📦 Email Purchase Import Summary</h2>
        <p style="color:#666;font-size:14px;">${items.length} item${items.length !== 1 ? 's' : ''} imported in ${Math.round(duration / 1000)}s</p>

        <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;width:100%;">
          <thead>
            <tr style="background:#2c3e50;color:#fff;">
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:left;">Purchase</th>
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:left;">Date</th>
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:left;">Set</th>
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:left;">Name</th>
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:center;">Cond</th>
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:right;">Cost</th>
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:right;">List £</th>
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:right;">COG%</th>
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:right;">Profit</th>
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:right;">Margin</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
            ${totalsRow}
          </tbody>
        </table>

        ${reviewSection}

        <p style="color:#999;font-size:11px;margin-top:24px;">
          Profit calculated using Amazon FBM UK fees (18.36%) + shipping (£3/£4).
        </p>
      </div>
    `;

    const subject = `Email Purchase Import: ${items.length} item${items.length !== 1 ? 's' : ''} imported (${fmt(totalCost)} invested)`;

    await this.send({ to: userEmail, subject, html });
  }
}

export const emailService = new EmailService();
