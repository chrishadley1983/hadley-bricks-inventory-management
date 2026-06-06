/**
 * POST /api/cron/ebay-category-audit
 *
 * Weekly cron job that audits all eBay listings for category issues
 * and emails a summary report to chris@hadleybricks.co.uk.
 *
 * Checks:
 * 1. Item categories — complete sets not in 19006
 * 2. Store categories — items in wrong store category or default "Other Items"
 *
 * Recommended schedule: Weekly, Mondays at 7am UTC
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayAuthService } from '@/lib/ebay/ebay-auth.service';
import { EbayTradingClient } from '@/lib/platform-stock/ebay/ebay-trading.client';
import {
  STORE_CATEGORY_BY_ID,
  getCorrectStoreCategory,
  looksLikeCompleteSet,
} from '@/lib/ebay/ebay-store-category-rules';
import { emailService } from '@/lib/email/email.service';

export const runtime = 'nodejs';
export const maxDuration = 120;

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
const REPORT_EMAIL = 'chris@hadleybricks.co.uk';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify cron secret
    const unauthorized = verifyCronAuth(request, 'EbayCategoryAudit');
    if (unauthorized) return unauthorized;

    console.log('[Cron EbayCategoryAudit] Starting weekly audit...');

    // Get eBay access token
    const supabase = createServiceRoleClient();
    const authService = new EbayAuthService(undefined, supabase);
    const accessToken = await authService.getAccessToken(DEFAULT_USER_ID);

    if (!accessToken) {
      await emailService.send({
        to: REPORT_EMAIL,
        subject: 'eBay Category Audit — Failed (no token)',
        html: '<p>Could not get eBay access token. Check credentials.</p>',
      });
      return NextResponse.json({ error: 'No access token' }, { status: 500 });
    }

    // Fetch all active listings
    const client = new EbayTradingClient({ accessToken, siteId: 3 });
    const listings = await client.getAllActiveListings();

    // Audit item categories
    const itemCategoryIssues: { id: string; title: string }[] = [];

    for (const listing of listings) {
      const catId = String(listing.ebayData?.categoryId || 'unknown');
      if (catId === '183448' && looksLikeCompleteSet(listing.title)) {
        itemCategoryIssues.push({ id: String(listing.platformItemId), title: listing.title });
      }
    }

    // Audit store categories
    const storeCategoryIssues: { id: string; title: string; current: string; suggested: string }[] = [];
    const storeCatDist: Record<string, number> = {};

    for (const listing of listings) {
      const storeCatId = String(listing.ebayData?.storeCategoryId || '1');
      const storeCatName = STORE_CATEGORY_BY_ID[storeCatId] || `Unknown (${storeCatId})`;
      storeCatDist[storeCatName] = (storeCatDist[storeCatName] || 0) + 1;

      const correct = getCorrectStoreCategory({
        title: listing.title,
        categoryId: listing.ebayData?.categoryId,
        categoryName: listing.ebayData?.categoryName,
        condition: listing.ebayData?.condition,
      });

      if (correct.id !== storeCatId) {
        storeCategoryIssues.push({
          id: String(listing.platformItemId),
          title: listing.title,
          current: storeCatName,
          suggested: correct.name,
        });
      }
    }

    const durationMs = Date.now() - startTime;
    const totalIssues = itemCategoryIssues.length + storeCategoryIssues.length;
    const isClean = totalIssues === 0;

    // Build email
    const statusBanner = isClean
      ? '<div style="background:#eafaf1;border-left:4px solid #27ae60;padding:12px 16px;margin:16px 0;border-radius:4px;"><strong style="color:#27ae60;">All Clear</strong> — all listings are in the correct categories.</div>'
      : `<div style="background:#fef9e7;border-left:4px solid #f39c12;padding:12px 16px;margin:16px 0;border-radius:4px;"><strong style="color:#f39c12;">${totalIssues} issue${totalIssues !== 1 ? 's' : ''} found</strong> — run the fix scripts to resolve.</div>`;

    // Store category distribution table
    const distRows = Object.entries(storeCatDist)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => {
        const pct = ((count / listings.length) * 100).toFixed(0);
        return `<tr><td style="padding:4px 10px;border:1px solid #ddd;">${name}</td><td style="padding:4px 10px;border:1px solid #ddd;text-align:right;">${count}</td><td style="padding:4px 10px;border:1px solid #ddd;text-align:right;">${pct}%</td></tr>`;
      })
      .join('');

    // Issue detail sections
    let itemIssueHtml = '';
    if (itemCategoryIssues.length > 0) {
      const rows = itemCategoryIssues
        .slice(0, 10)
        .map((i) => `<tr><td style="padding:4px 10px;border:1px solid #ddd;">${i.id}</td><td style="padding:4px 10px;border:1px solid #ddd;">${i.title}</td></tr>`)
        .join('');
      const more = itemCategoryIssues.length > 10 ? `<p style="color:#888;font-size:12px;">... and ${itemCategoryIssues.length - 10} more</p>` : '';
      itemIssueHtml = `
        <h3 style="color:#e74c3c;">Item Category Issues (${itemCategoryIssues.length})</h3>
        <p style="font-size:13px;">Complete sets in 183448 (Bricks & Parts) that should be in 19006 (Complete Sets).</p>
        <table style="border-collapse:collapse;font-size:13px;width:100%;">
          <thead><tr style="background:#f0f0f0;"><th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Item ID</th><th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Title</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${more}
        <p style="font-size:12px;">Fix: <code>npx tsx apps/web/scripts/ebay-fix-item-categories.ts</code></p>`;
    }

    let storeIssueHtml = '';
    if (storeCategoryIssues.length > 0) {
      // Group by change type
      const groups: Record<string, number> = {};
      for (const i of storeCategoryIssues) {
        const key = `${i.current} → ${i.suggested}`;
        groups[key] = (groups[key] || 0) + 1;
      }
      const groupRows = Object.entries(groups)
        .sort((a, b) => b[1] - a[1])
        .map(([change, count]) => `<tr><td style="padding:4px 10px;border:1px solid #ddd;">${change}</td><td style="padding:4px 10px;border:1px solid #ddd;text-align:right;">${count}</td></tr>`)
        .join('');

      storeIssueHtml = `
        <h3 style="color:#e67e22;">Store Category Issues (${storeCategoryIssues.length})</h3>
        <table style="border-collapse:collapse;font-size:13px;width:100%;">
          <thead><tr style="background:#f0f0f0;"><th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Change Needed</th><th style="padding:6px 10px;border:1px solid #ddd;text-align:right;">Count</th></tr></thead>
          <tbody>${groupRows}</tbody>
        </table>
        <p style="font-size:12px;">Fix: <code>npx tsx apps/web/scripts/ebay-fix-store-categories.ts</code></p>`;
    }

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">
        <h2 style="color:#333;">eBay Category Audit Report</h2>
        <p style="color:#666;font-size:13px;">Weekly audit of ${listings.length} active listings | ${(durationMs / 1000).toFixed(1)}s</p>

        ${statusBanner}

        <h3>Store Category Distribution</h3>
        <table style="border-collapse:collapse;font-size:13px;width:100%;">
          <thead><tr style="background:#2c3e50;color:#fff;"><th style="padding:6px 10px;border:1px solid #2c3e50;text-align:left;">Category</th><th style="padding:6px 10px;border:1px solid #2c3e50;text-align:right;">Count</th><th style="padding:6px 10px;border:1px solid #2c3e50;text-align:right;">%</th></tr></thead>
          <tbody>${distRows}</tbody>
        </table>

        ${itemIssueHtml}
        ${storeIssueHtml}

        <p style="color:#999;font-size:11px;margin-top:24px;">
          Hadley Bricks Inventory Management — automated weekly audit
        </p>
      </div>`;

    const subject = isClean
      ? `eBay Category Audit — All Clear (${listings.length} listings)`
      : `eBay Category Audit — ${totalIssues} Issues (${listings.length} listings)`;

    await emailService.send({ to: REPORT_EMAIL, subject, html });

    console.log(
      `[Cron EbayCategoryAudit] Complete: ${listings.length} listings, ` +
        `${itemCategoryIssues.length} item issues, ${storeCategoryIssues.length} store issues (${durationMs}ms)`
    );

    return NextResponse.json({
      success: true,
      totalListings: listings.length,
      itemCategoryIssues: itemCategoryIssues.length,
      storeCategoryIssues: storeCategoryIssues.length,
      durationMs,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Cron EbayCategoryAudit] Error:', error);

    await emailService.send({
      to: REPORT_EMAIL,
      subject: 'eBay Category Audit — FAILED',
      html: `<p>The weekly eBay category audit failed:</p><pre>${msg}</pre>`,
    }).catch(() => {});

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
