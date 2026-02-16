/**
 * Email Service
 *
 * Handles transactional email notifications for business-critical events.
 * Uses Resend for email delivery.
 *
 * @see https://resend.com/docs
 */

import { Resend } from 'resend';
import type { VercelUsageReport } from '@/lib/services/vercel-usage.service';
import type { CostAllocationSummary } from '@/lib/services/cost-allocation.service';

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

export interface CostAllocationReportParams {
  userEmail: string;
  summary: CostAllocationSummary;
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

  /**
   * Send Vercel usage monitoring report with RAG-status metrics table
   */
  async sendVercelUsageReport(params: {
    userEmail: string;
    report: VercelUsageReport;
  }): Promise<void> {
    const { userEmail, report } = params;

    const statusEmoji: Record<string, string> = { GREEN: '🟢', AMBER: '🟡', RED: '🔴' };
    const statusColor: Record<string, string> = {
      GREEN: '#27ae60',
      AMBER: '#f39c12',
      RED: '#e74c3c',
    };

    // Count non-GREEN metrics
    const redCount = report.metrics.filter((m) => m.status === 'RED').length;
    const amberCount = report.metrics.filter((m) => m.status === 'AMBER').length;

    // Subject line based on overall status
    let subject: string;
    if (redCount > 0) {
      subject = `🔴 ALERT: Vercel usage - ${redCount} metric(s) critical`;
    } else if (amberCount > 0) {
      subject = `🟡 WARNING: Vercel usage - ${amberCount} metric(s) elevated`;
    } else {
      subject = `✅ Vercel Usage Report - All metrics GREEN`;
    }

    // Alert banner (conditional)
    let alertBanner = '';
    if (report.overallStatus === 'RED') {
      alertBanner = `
        <div style="background:#fde8e8;border-left:4px solid #e74c3c;padding:12px 16px;margin:16px 0;border-radius:4px;">
          <strong style="color:#e74c3c;">🔴 CRITICAL:</strong> ${redCount} metric(s) exceeding 75% of Hobby plan limits.
          ${amberCount > 0 ? `Additionally ${amberCount} metric(s) above 50%.` : ''}
        </div>`;
    } else if (report.overallStatus === 'AMBER') {
      alertBanner = `
        <div style="background:#fef9e7;border-left:4px solid #f39c12;padding:12px 16px;margin:16px 0;border-radius:4px;">
          <strong style="color:#f39c12;">🟡 WARNING:</strong> ${amberCount} metric(s) between 50-75% of Hobby plan limits.
        </div>`;
    } else {
      alertBanner = `
        <div style="background:#eafaf1;border-left:4px solid #27ae60;padding:12px 16px;margin:16px 0;border-radius:4px;">
          <strong style="color:#27ae60;">✅ ALL GREEN:</strong> All metrics below 50% of Hobby plan limits.
        </div>`;
    }

    // Build metrics table rows
    const metricRows = report.metrics
      .map((m) => {
        const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:bold;color:#fff;background:${statusColor[m.status]};">${m.status}</span>`;
        return `<tr>
          <td style="padding:8px 10px;border:1px solid #ddd;">${m.name}</td>
          <td style="padding:8px 10px;border:1px solid #ddd;text-align:right;">${m.currentFormatted}</td>
          <td style="padding:8px 10px;border:1px solid #ddd;text-align:right;">${m.limitFormatted}</td>
          <td style="padding:8px 10px;border:1px solid #ddd;text-align:right;">${m.usedPercent.toFixed(1)}%</td>
          <td style="padding:8px 10px;border:1px solid #ddd;text-align:center;">${badge}</td>
        </tr>`;
      })
      .join('\n');

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://hadley-bricks.vercel.app';
    const usageUrl = 'https://vercel.com/account/usage';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">
        <h2 style="color:#333;margin-bottom:4px;">VERCEL USAGE REPORT</h2>
        <p style="color:#666;font-size:13px;margin-top:0;">
          Plan: <strong>${report.plan}</strong> | Period: <strong>${report.period.formatted}</strong>
        </p>

        ${alertBanner}

        <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;width:100%;margin-top:16px;">
          <thead>
            <tr style="background:#2c3e50;color:#fff;">
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:left;">Metric</th>
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:right;">Current</th>
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:right;">Limit</th>
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:right;">Used %</th>
              <th style="padding:8px 10px;border:1px solid #2c3e50;text-align:center;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${metricRows}
          </tbody>
        </table>

        <p style="color:#888;font-size:11px;margin-top:16px;">
          ${statusEmoji.GREEN} GREEN &lt; 50% | ${statusEmoji.AMBER} AMBER 50-75% | ${statusEmoji.RED} RED &gt; 75%
        </p>

        ${!report.fromApi ? '<p style="color:#888;font-size:11px;">Note: Data provided manually (Vercel API not available on Hobby plan).</p>' : ''}

        <p style="color:#888;font-size:11px;">
          Cron jobs have been migrated to GCP Cloud Scheduler to reduce Function Invocations.
        </p>

        <p style="font-size:12px;margin-top:16px;">
          <a href="${usageUrl}" style="color:#3498db;">View on Vercel</a> |
          <a href="${appUrl}" style="color:#3498db;">Open App</a>
        </p>
      </div>
    `;

    await this.send({ to: userEmail, subject, html });
  }

  /**
   * Send cost allocation report with per-purchase breakdown
   */
  async sendCostAllocationReport(params: CostAllocationReportParams): Promise<void> {
    const { userEmail, summary } = params;

    // Only include purchases that had changes
    const changedResults = summary.results.filter((r) => r.changes.length > 0);

    if (changedResults.length === 0) return;

    const fmt = (n: number) => `£${n.toFixed(2)}`;
    const durationSec = Math.round(summary.durationMs / 1000);

    // Build per-purchase sections
    const purchaseSections = changedResults
      .map((result) => {
        const changeRows = result.changes
          .map((c) => {
            const changeColor = c.change >= 0 ? '#e67e22' : '#27ae60';
            const changeSign = c.change >= 0 ? '+' : '';
            return `<tr>
              <td style="padding:4px 8px;border:1px solid #ddd;">${c.name}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">${c.type === 'inventory_item' ? 'Set' : 'Upload'}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmt(c.listingValue)}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmt(c.oldCost)}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${fmt(c.newCost)}</td>
              <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;color:${changeColor};">${changeSign}${fmt(c.change)}</td>
            </tr>`;
          })
          .join('\n');

        const purchaseLabel = result.purchaseDescription || result.purchaseSource || result.purchaseId;
        return `
          <tr style="background:#2c3e50;color:#fff;">
            <td style="padding:8px 10px;border:1px solid #2c3e50;" colspan="4">
              <strong>${purchaseLabel}</strong>
            </td>
            <td style="padding:8px 10px;border:1px solid #2c3e50;text-align:right;" colspan="1">
              Cost: ${fmt(result.purchaseCost)}
            </td>
            <td style="padding:8px 10px;border:1px solid #2c3e50;text-align:right;" colspan="1">
              LV: ${fmt(result.totalListingValue)}
            </td>
          </tr>
          ${changeRows}`;
      })
      .join('\n');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;">
        <h2 style="color:#333;">💰 Cost Allocation Report</h2>
        <p style="color:#666;font-size:14px;">
          ${summary.purchasesWithChanges} purchase${summary.purchasesWithChanges !== 1 ? 's' : ''} updated,
          ${summary.totalChanges} item${summary.totalChanges !== 1 ? 's' : ''} changed
          in ${durationSec}s.
          ${summary.purchasesSkipped} skipped, ${summary.purchasesProcessed} processed.
        </p>

        <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;width:100%;">
          <thead>
            <tr style="background:#34495e;color:#fff;">
              <th style="padding:8px 10px;border:1px solid #34495e;text-align:left;">Item</th>
              <th style="padding:8px 10px;border:1px solid #34495e;text-align:center;">Type</th>
              <th style="padding:8px 10px;border:1px solid #34495e;text-align:right;">List Value</th>
              <th style="padding:8px 10px;border:1px solid #34495e;text-align:right;">Old Cost</th>
              <th style="padding:8px 10px;border:1px solid #34495e;text-align:right;">New Cost</th>
              <th style="padding:8px 10px;border:1px solid #34495e;text-align:right;">Change</th>
            </tr>
          </thead>
          <tbody>
            ${purchaseSections}
          </tbody>
        </table>

        <p style="color:#999;font-size:11px;margin-top:24px;">
          Cost allocated proportionally by listing value. Rounding remainder applied to highest-value item.
        </p>
      </div>
    `;

    const subject = `Cost Allocation: ${summary.totalChanges} item${summary.totalChanges !== 1 ? 's' : ''} updated across ${summary.purchasesWithChanges} purchase${summary.purchasesWithChanges !== 1 ? 's' : ''}`;

    await this.send({ to: userEmail, subject, html });
  }
}

export const emailService = new EmailService();
