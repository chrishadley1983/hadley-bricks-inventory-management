/**
 * POST /api/cron/email-purchases
 *
 * Daily cron endpoint that orchestrates automated email purchase import:
 * 1. Scans Gmail for Vinted/eBay purchase confirmation emails (last 3 days)
 * 2. Enriches candidates with Brickset lookup, ASIN, and Amazon pricing
 * 3. Batch-imports ready candidates as purchase+inventory records
 * 4. Sends Discord notification with results
 *
 * Uses existing service endpoints via internal fetch.
 * Requires SERVICE_API_KEY env var for authenticating with service endpoints.
 *
 * Recommended schedule: Daily at 2:17am UTC
 */

import { NextRequest, NextResponse } from 'next/server';
import { discordService } from '@/lib/notifications';
import { emailService } from '@/lib/email';
import type { PurchaseImportEmailItem } from '@/lib/email';
import { jobExecutionService } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

/** Base URL for internal API calls */
function getBaseUrl(): string {
  // In production, use VERCEL_URL or APP_URL
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }
  return 'http://localhost:3000';
}

/** Make an authenticated internal API call */
async function internalFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const serviceApiKey = process.env.SERVICE_API_KEY;
  if (!serviceApiKey) {
    throw new Error('SERVICE_API_KEY environment variable is not set');
  }

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;

  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': serviceApiKey,
      ...(options.headers || {}),
    },
  });
}

interface ScanCandidate {
  source: 'Vinted' | 'eBay';
  order_reference: string;
  seller_username: string;
  item_name: string;
  set_number: string | null;
  cost: number;
  purchase_date: string;
  email_id: string;
  email_subject: string;
  email_date: string;
  payment_method: string;
  suggested_condition: 'New' | 'Used';
  bundle_group?: string;
  bundle_total_cost?: number;
  bundle_index?: number;
}

interface EnrichedCandidate {
  source: 'Vinted' | 'eBay';
  order_reference: string;
  email_id: string;
  email_subject: string;
  email_date: string;
  seller_username: string;
  set_number: string;
  set_name: string;
  cost: number;
  purchase_date: string;
  condition: 'New' | 'Used';
  payment_method: string;
  amazon_asin?: string;
  list_price?: number;
  bundle_group?: string;
  bundle_total_cost?: number;
  bundle_index?: number;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // 1. Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron EmailPurchases] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const execution = await jobExecutionService.start('email-purchases', 'cron');

    console.log('[Cron EmailPurchases] Starting automated email purchase import');

    // 2. Scan emails (look back 7 days to catch weekend purchases and cron gaps)
    console.log('[Cron EmailPurchases] Scanning emails...');
    const scanResponse = await internalFetch('/api/service/purchases/scan-emails?days=7');

    if (!scanResponse.ok) {
      const scanError = await scanResponse.text();
      throw new Error(`Email scan failed (${scanResponse.status}): ${scanError}`);
    }

    const scanResult = await scanResponse.json();
    const candidates: ScanCandidate[] = scanResult.data?.candidates ?? [];
    const needsReview: ScanCandidate[] = scanResult.data?.needs_review ?? [];

    console.log(
      `[Cron EmailPurchases] Scan complete: ${candidates.length} ready, ${needsReview.length} need review, ${scanResult.data?.already_processed_count ?? 0} already processed`
    );

    if (candidates.length === 0) {
      console.log('[Cron EmailPurchases] No new candidates to import');
      await execution.complete(
        { message: 'No new candidates', needsReview: needsReview.length, alreadyProcessed: scanResult.data?.already_processed_count ?? 0 },
        200, 0, 0
      );
      return NextResponse.json({
        success: true,
        message: 'No new candidates to import',
        scanned: scanResult.data?.total_found ?? 0,
        alreadyProcessed: scanResult.data?.already_processed_count ?? 0,
        needsReview: needsReview.length,
        duration: Date.now() - startTime,
      });
    }

    // 3. Enrich candidates with Brickset data + ASIN + pricing
    const enriched: EnrichedCandidate[] = [];
    const skipItems: Array<{ email_id: string; source: 'Vinted' | 'eBay'; order_reference?: string; email_subject?: string; email_date?: string; item_name?: string; cost?: number; seller_username?: string; skip_reason: string }> = [];

    for (const candidate of candidates) {
      if (!candidate.set_number) {
        skipItems.push({
          email_id: candidate.email_id,
          source: candidate.source,
          order_reference: candidate.order_reference,
          email_subject: candidate.email_subject,
          email_date: candidate.email_date,
          item_name: candidate.item_name,
          cost: candidate.cost,
          seller_username: candidate.seller_username,
          skip_reason: 'no_set_number',
        });
        continue;
      }

      try {
        // ASIN lookup (also returns title for name fallback)
        let amazonAsin: string | undefined;
        let setName = candidate.item_name;
        const asinResponse = await internalFetch(
          `/api/service/inventory/lookup-asin?setNumber=${encodeURIComponent(candidate.set_number)}`
        );
        if (asinResponse.ok) {
          const asinData = await asinResponse.json();
          amazonAsin = asinData.data?.asin;
          if (asinData.data?.title) {
            setName = asinData.data.title;
          }
        }

        // Brickset lookup (overrides ASIN title if available)
        try {
          const bricksetResponse = await internalFetch(
            `/api/service/brickset/lookup?setNumber=${encodeURIComponent(candidate.set_number)}`
          );
          if (bricksetResponse.ok) {
            const bricksetData = await bricksetResponse.json();
            if (bricksetData.data?.name) {
              setName = bricksetData.data.name;
            }
          }
        } catch {
          // Brickset optional - ASIN title used as fallback
        }

        // Amazon pricing (if we have an ASIN)
        let listPrice: number | undefined;
        if (amazonAsin) {
          const pricingResponse = await internalFetch(
            `/api/service/amazon/competitive-summary?asins=${encodeURIComponent(amazonAsin)}`
          );
          if (pricingResponse.ok) {
            const pricingData = await pricingResponse.json();
            const asinPricing = pricingData.data?.[amazonAsin];
            listPrice = asinPricing?.buyBoxPrice ?? asinPricing?.lowestNewPrice;
          }
        }

        enriched.push({
          source: candidate.source,
          order_reference: candidate.order_reference,
          email_id: candidate.email_id,
          email_subject: candidate.email_subject,
          email_date: candidate.email_date,
          seller_username: candidate.seller_username,
          set_number: candidate.set_number,
          set_name: setName,
          cost: candidate.cost,
          purchase_date: candidate.purchase_date,
          condition: candidate.suggested_condition,
          payment_method: candidate.payment_method,
          amazon_asin: amazonAsin,
          list_price: listPrice,
          bundle_group: candidate.bundle_group,
          bundle_total_cost: candidate.bundle_total_cost,
          bundle_index: candidate.bundle_index,
        });
      } catch (err) {
        console.warn(`[Cron EmailPurchases] Failed to enrich ${candidate.set_number}:`, err);
        // Still import with basic data
        enriched.push({
          source: candidate.source,
          order_reference: candidate.order_reference,
          email_id: candidate.email_id,
          email_subject: candidate.email_subject,
          email_date: candidate.email_date,
          seller_username: candidate.seller_username,
          set_number: candidate.set_number,
          set_name: candidate.item_name,
          cost: candidate.cost,
          purchase_date: candidate.purchase_date,
          condition: candidate.suggested_condition,
          payment_method: candidate.payment_method,
          bundle_group: candidate.bundle_group,
          bundle_total_cost: candidate.bundle_total_cost,
          bundle_index: candidate.bundle_index,
        });
      }
    }

    // Also mark needs_review items as skipped
    for (const item of needsReview) {
      skipItems.push({
        email_id: item.email_id,
        source: item.source,
        order_reference: item.order_reference,
        email_subject: item.email_subject,
        email_date: item.email_date,
        item_name: item.item_name,
        cost: item.cost,
        seller_username: item.seller_username,
        skip_reason: 'no_set_number',
      });
    }

    // 4. Batch import - separate standalone items from bundle groups
    const bundleGroups = new Map<string, EnrichedCandidate[]>();
    const standaloneItems: EnrichedCandidate[] = [];

    for (const item of enriched) {
      if (item.bundle_group) {
        const group = bundleGroups.get(item.bundle_group) || [];
        group.push(item);
        bundleGroups.set(item.bundle_group, group);
      } else {
        standaloneItems.push(item);
      }
    }

    // Convert bundle groups to import format
    const bundleImports = Array.from(bundleGroups.values()).map(items => ({
      email_id: items[0].email_id,
      email_subject: items[0].email_subject,
      email_date: items[0].email_date,
      source: items[0].source,
      order_reference: items[0].order_reference,
      seller_username: items[0].seller_username,
      total_cost: items[0].bundle_total_cost!,
      purchase_date: items[0].purchase_date,
      payment_method: items[0].payment_method,
      items: items.map(i => ({
        set_number: i.set_number,
        set_name: i.set_name,
        condition: i.condition,
        amazon_asin: i.amazon_asin,
        list_price: i.list_price,
      })),
    }));

    console.log(`[Cron EmailPurchases] Importing ${standaloneItems.length} standalone + ${bundleImports.length} bundles (${enriched.length} total items)...`);

    let importResult = null;
    if (enriched.length > 0) {
      const importResponse = await internalFetch('/api/service/purchases/batch-import', {
        method: 'POST',
        body: JSON.stringify({
          items: standaloneItems,
          bundles: bundleImports,
          skip_items: skipItems,
          automated: true,
          storage_location: 'TBC',
        }),
      });

      if (!importResponse.ok) {
        const importError = await importResponse.text();
        throw new Error(`Batch import failed (${importResponse.status}): ${importError}`);
      }

      importResult = await importResponse.json();
    } else if (skipItems.length > 0) {
      // Just record the skipped items
      const skipResponse = await internalFetch('/api/service/purchases/batch-import', {
        method: 'POST',
        body: JSON.stringify({
          items: [],
          skip_items: skipItems,
          automated: true,
        }),
      });
      if (skipResponse.ok) {
        importResult = await skipResponse.json();
      }
    }

    const summary = importResult?.data?.summary ?? {};
    const duration = Date.now() - startTime;

    console.log(
      `[Cron EmailPurchases] Complete: ${summary.created_count ?? 0} imported, ${summary.failed_count ?? 0} failed, ${summary.skipped_count ?? 0} skipped (${Math.round(duration / 1000)}s)`
    );

    // 5. Send Discord notification
    const createdCount = summary.created_count ?? 0;
    const failedCount = summary.failed_count ?? 0;
    const skippedCount = summary.skipped_count ?? 0;
    const allSkipped = [...skipItems, ...needsReview.filter(nr => !skipItems.some(s => s.email_id === nr.email_id))];

    if (createdCount > 0 || failedCount > 0 || allSkipped.length > 0) {
      const lines = [`Imported: ${createdCount} purchases`];
      if (summary.total_invested) {
        lines.push(`Invested: \u00a3${summary.total_invested.toFixed(2)}`);
      }
      if (summary.overall_roi_percent) {
        lines.push(`Est. ROI: ${summary.overall_roi_percent}%`);
      }
      if (failedCount > 0) {
        lines.push(`Failed: ${failedCount}`);
      }
      if (allSkipped.length > 0) {
        lines.push(`Needs Review: ${allSkipped.length}`);
      }
      lines.push(`Duration: ${Math.round(duration / 1000)}s`);

      // Build embed fields for skipped items needing review
      const fields: Array<{ name: string; value: string; inline: boolean }> = [];

      if (allSkipped.length > 0) {
        const maxItems = 10;
        const itemsToShow = allSkipped.slice(0, maxItems);
        const reviewLines = itemsToShow.map(item => {
          const source = 'source' in item ? item.source : 'Unknown';
          const name = ('item_name' in item ? item.item_name : '') || 'Unknown item';
          const cost = 'cost' in item && item.cost != null ? `\u00a3${Number(item.cost).toFixed(2)}` : '?';
          const seller = 'seller_username' in item && item.seller_username ? ` (${item.seller_username})` : '';
          return `\u2022 **${source}** - ${name} - ${cost}${seller}`;
        });

        if (allSkipped.length > maxItems) {
          reviewLines.push(`...and ${allSkipped.length - maxItems} more`);
        }

        fields.push({
          name: `Needs Review (${allSkipped.length})`,
          value: reviewLines.join('\n').slice(0, 1024),
          inline: false,
        });

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        fields.push({
          name: 'Review Queue',
          value: `[Open Review Queue](${appUrl}/purchases?tab=review)`,
          inline: false,
        });
      }

      const embed = {
        title: failedCount > 0
          ? '\u26a0\ufe0f Email Purchase Import (with errors)'
          : allSkipped.length > 0
            ? '\ud83d\udcec Email Purchase Import (needs review)'
            : '\u2705 Email Purchase Import Complete',
        description: lines.join('\n'),
        color: failedCount > 0 ? 0xe67e22 : allSkipped.length > 0 ? 0xfee75c : 0x57f287,
        fields: fields.length > 0 ? fields : undefined,
      };

      await discordService.send('sync-status', embed);
    }

    // 6. Send email summary with profit analysis
    if (createdCount > 0 && importResult?.data?.created) {
      try {
        const createdItems: Array<{
          email_id: string;
          set_number: string;
          set_name: string;
          cost: number;
          list_price: number | null;
        }> = importResult.data.created;

        // Build a lookup from enriched candidates for source/condition/bundle info
        const enrichedMap = new Map(
          enriched.map((e) => [`${e.email_id}:${e.set_number}`, e])
        );

        // Track which bundle groups have already had their first row labelled
        const seenBundleGroups = new Set<string>();

        const emailItems: PurchaseImportEmailItem[] = createdItems.map((c) => {
          const e = enrichedMap.get(`${c.email_id}:${c.set_number}`);
          const source = e?.source ?? 'Unknown';
          const condition = e?.condition ?? 'Unknown';
          const purchaseDate = e?.purchase_date ?? '';
          const bundleGroup = e?.bundle_group;
          const bundleTotalCost = e?.bundle_total_cost;

          let purchaseLabel = '';
          if (bundleGroup) {
            if (!seenBundleGroups.has(bundleGroup)) {
              seenBundleGroups.add(bundleGroup);
              purchaseLabel = `\u00a3${(bundleTotalCost ?? c.cost).toFixed(2)} Bundle`;
            }
            // subsequent bundle items get empty label
          } else {
            purchaseLabel = `\u00a3${c.cost.toFixed(2)} (${source})`;
          }

          return {
            set_number: c.set_number,
            set_name: c.set_name,
            source,
            condition,
            cost: c.cost,
            list_price: c.list_price,
            purchase_date: purchaseDate,
            purchase_label: purchaseLabel,
          };
        });

        const reviewItems = allSkipped.map((s) => ({
          source: 'source' in s ? String(s.source) : 'Unknown',
          item_name: ('item_name' in s ? String(s.item_name) : '') || 'Unknown item',
          cost: 'cost' in s && s.cost != null ? Number(s.cost) : 0,
        }));

        await emailService.sendPurchaseImportSummary({
          userEmail: 'chrishadley1983@gmail.com',
          items: emailItems,
          needsReview: reviewItems,
          duration,
        });

        console.log(`[Cron EmailPurchases] Email summary sent (${emailItems.length} items)`);
      } catch (emailErr) {
        console.warn('[Cron EmailPurchases] Failed to send email summary:', emailErr);
        // Email failure should not fail the cron
      }
    }

    await execution.complete(
      { created: createdCount, failed: failedCount, skipped: skippedCount, totalInvested: summary.total_invested },
      200, createdCount, failedCount
    );

    return NextResponse.json({
      success: true,
      created: createdCount,
      failed: failedCount,
      skipped: skippedCount,
      totalInvested: summary.total_invested,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    console.error('[Cron EmailPurchases] Error:', error);

    // Try to send Discord alert
    try {
      await discordService.sendAlert({
        title: '\ud83d\udd34 Email Purchase Import Failed',
        message: `Error: ${errorMsg}\nDuration: ${Math.round(duration / 1000)}s`,
        priority: 'high',
      });
    } catch {
      // Ignore Discord errors
    }

    return NextResponse.json(
      { error: errorMsg, duration },
      { status: 500 }
    );
  }
}

// Support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
