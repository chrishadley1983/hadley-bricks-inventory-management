/**
 * Service API: Batch Import Purchases
 *
 * POST - Create multiple 1:1 purchase+inventory records from email scan
 * Supports automated mode for scheduled jobs (no confirmation needed)
 * Records all processed emails for deduplication
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withServiceAuth, getSystemUserId } from '@/lib/middleware/service-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';

const ImportItemSchema = z.object({
  source: z.enum(['Vinted', 'eBay']),
  order_reference: z.string().min(1),
  email_id: z.string().min(1), // Required for deduplication tracking
  email_subject: z.string().optional(),
  email_date: z.string().optional(),
  seller_username: z.string().optional(),
  set_number: z.string().min(1),
  set_name: z.string().min(1),
  cost: z.number().nonnegative(),
  purchase_date: z.string().min(1),
  condition: z.enum(['New', 'Used']),
  payment_method: z.string().min(1),
  amazon_asin: z.string().optional(),
  list_price: z.number().positive().optional(),
  storage_location: z.string().optional(),
});

const SkipItemSchema = z.object({
  email_id: z.string().min(1),
  source: z.enum(['Vinted', 'eBay']),
  order_reference: z.string().optional(),
  email_subject: z.string().optional(),
  email_date: z.string().optional(),
  item_name: z.string().optional(),
  cost: z.number().optional(),
  seller_username: z.string().optional(),
  skip_reason: z.string().min(1), // 'no_set_number', 'invalid_set', 'manual_skip', etc.
});

const BundleItemSchema = z.object({
  set_number: z.string().min(1),
  set_name: z.string().min(1),
  condition: z.enum(['New', 'Used']),
  amazon_asin: z.string().optional(),
  list_price: z.number().positive().optional(),
  storage_location: z.string().optional(),
});

const BundleSchema = z.object({
  email_id: z.string().min(1),
  email_subject: z.string().optional(),
  email_date: z.string().optional(),
  source: z.enum(['Vinted', 'eBay']),
  order_reference: z.string().min(1),
  seller_username: z.string().optional(),
  total_cost: z.number().nonnegative(),
  purchase_date: z.string().min(1),
  payment_method: z.string().min(1),
  items: z.array(BundleItemSchema).min(1).max(20),
});

const BatchImportSchema = z.object({
  items: z.array(ImportItemSchema).default([]),
  bundles: z.array(BundleSchema).default([]),  // Bundle groups: 1 purchase per bundle, N inventory items
  skip_items: z.array(SkipItemSchema).default([]), // Items to mark as skipped
  automated: z.boolean().optional().default(false),
  storage_location: z.string().optional().default('TBC'),
});

interface ImportResult {
  purchase_id: string;
  inventory_id: string;
  email_id: string;
  set_number: string;
  set_name: string;
  cost: number;
  list_price: number | null;
  roi_percent: number | null;
}

interface ImportError {
  email_id: string;
  set_number: string;
  order_reference: string;
  error: string;
}

interface SkipResult {
  email_id: string;
  skip_reason: string;
}

/**
 * POST /api/service/purchases/batch-import
 * Create 1:1 purchase+inventory records (one purchase per item)
 * Also records skipped items for deduplication
 *
 * Body:
 * - items: Array of items to import
 * - skip_items: Array of items to mark as skipped (won't be shown again)
 * - automated: If true, uses all defaults without prompts (for scheduled jobs)
 * - storage_location: Default storage location for all items
 */
export async function POST(request: NextRequest) {
  return withServiceAuth(request, ['write'], async (_keyInfo) => {
    try {
      const body = await request.json();
      const parsed = BatchImportSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const { items, bundles, skip_items, automated, storage_location } = parsed.data;
      const supabase = createServiceRoleClient();
      const userId = await getSystemUserId();

      const created: ImportResult[] = [];
      const failed: ImportError[] = [];
      const skipped: SkipResult[] = [];
      let totalInvested = 0;
      let totalExpectedRevenue = 0;

      // Process items to import
      for (const item of items) {
        try {
          // Check if email already processed (prevent duplicates)
          const { data: existingEmail } = await supabase
            .from('processed_purchase_emails')
            .select('id')
            .eq('email_id', item.email_id)
            .limit(1)
            .single();

          if (existingEmail) {
            failed.push({
              email_id: item.email_id,
              set_number: item.set_number,
              order_reference: item.order_reference,
              error: 'Email already processed',
            });
            continue;
          }

          // 1. Create purchase record (1:1 mapping)
          const { data: purchase, error: purchaseError } = await supabase
            .from('purchases')
            .insert({
              user_id: userId,
              source: item.source,
              cost: item.cost,
              payment_method: item.payment_method,
              purchase_date: item.purchase_date,
              short_description: `${item.set_number} ${item.set_name}`,
              description: `${item.set_name} from ${item.seller_username || item.source}`,
              reference: item.order_reference,
            })
            .select('id')
            .single();

          if (purchaseError || !purchase) {
            // Record as failed in processed_purchase_emails
            await supabase.from('processed_purchase_emails').insert({
              email_id: item.email_id,
              source: item.source,
              order_reference: item.order_reference,
              status: 'failed',
              error_message: purchaseError?.message || 'Failed to create purchase',
              email_subject: item.email_subject,
              email_date: item.email_date,
              item_name: item.set_name,
              cost: item.cost,
            });

            failed.push({
              email_id: item.email_id,
              set_number: item.set_number,
              order_reference: item.order_reference,
              error: purchaseError?.message || 'Failed to create purchase',
            });
            continue;
          }

          // 2. Generate SKU (format: N{number} for New, U{number} for Used)
          const skuPrefix = item.condition === 'New' ? 'N' : 'U';
          const { data: skuRows } = await supabase
            .from('inventory_items')
            .select('sku')
            .not('sku', 'is', null)
            .order('created_at', { ascending: false })
            .limit(200);

          let maxNum = 0;
          if (skuRows) {
            for (const row of skuRows) {
              const match = row.sku?.match(/^[NU](\d+)$/);
              if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
              }
            }
          }
          const newSku = `${skuPrefix}${maxNum + 1}`;

          // 3. Create inventory item
          const storageLocation = item.storage_location || storage_location || 'TBC';
          const { data: inventory, error: inventoryError } = await supabase
            .from('inventory_items')
            .insert({
              user_id: userId,
              set_number: item.set_number,
              item_name: item.set_name,
              condition: item.condition,
              cost: item.cost,
              purchase_id: purchase.id,
              linked_lot: item.order_reference, // Links back to purchase reference
              source: item.source, // eBay or Vinted
              purchase_date: item.purchase_date,
              listing_platform: 'amazon', // Always Amazon for email imports
              storage_location: storageLocation,
              amazon_asin: item.amazon_asin,
              listing_value: item.list_price, // listing_value is the column name in DB
              sku: newSku,
              status: 'Not Yet Received',
              notes: `Auto-imported. Seller: ${item.seller_username || 'unknown'}. https://mail.google.com/mail/u/0/#all/${item.email_id}`,
            })
            .select('id')
            .single();

          if (inventoryError || !inventory) {
            // Rollback: delete the purchase we just created
            await supabase.from('purchases').delete().eq('id', purchase.id);

            // Record as failed
            await supabase.from('processed_purchase_emails').insert({
              email_id: item.email_id,
              source: item.source,
              order_reference: item.order_reference,
              status: 'failed',
              error_message: inventoryError?.message || 'Failed to create inventory item',
              email_subject: item.email_subject,
              email_date: item.email_date,
              item_name: item.set_name,
              cost: item.cost,
            });

            failed.push({
              email_id: item.email_id,
              set_number: item.set_number,
              order_reference: item.order_reference,
              error: inventoryError?.message || 'Failed to create inventory item',
            });
            continue;
          }

          // 3. Record successful import in processed_purchase_emails
          await supabase.from('processed_purchase_emails').insert({
            email_id: item.email_id,
            source: item.source,
            order_reference: item.order_reference,
            purchase_id: purchase.id,
            inventory_id: inventory.id,
            status: 'imported',
            email_subject: item.email_subject,
            email_date: item.email_date,
            item_name: item.set_name,
            cost: item.cost,
          });

          // Calculate ROI if list price is available
          let roiPercent: number | null = null;
          if (item.list_price && item.cost > 0) {
            // Rough estimate: 15% Amazon fees
            const estimatedNetRevenue = item.list_price * 0.85;
            const profit = estimatedNetRevenue - item.cost;
            roiPercent = Math.round((profit / item.cost) * 100);
          }

          created.push({
            purchase_id: purchase.id,
            inventory_id: inventory.id,
            email_id: item.email_id,
            set_number: item.set_number,
            set_name: item.set_name,
            cost: item.cost,
            list_price: item.list_price || null,
            roi_percent: roiPercent,
          });

          totalInvested += item.cost;
          if (item.list_price) {
            totalExpectedRevenue += item.list_price;
          }
        } catch (err) {
          // Record as failed
          await supabase.from('processed_purchase_emails').insert({
            email_id: item.email_id,
            source: item.source,
            order_reference: item.order_reference,
            status: 'failed',
            error_message: err instanceof Error ? err.message : 'Unknown error',
            email_subject: item.email_subject,
            email_date: item.email_date,
            item_name: item.set_name,
            cost: item.cost,
          });

          failed.push({
            email_id: item.email_id,
            set_number: item.set_number,
            order_reference: item.order_reference,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }

      // Process bundles: 1 purchase per bundle, N inventory items with cost allocation
      for (const bundle of bundles) {
        try {
          // Check if email already processed
          const { data: existingBundleEmail } = await supabase
            .from('processed_purchase_emails')
            .select('id')
            .eq('email_id', bundle.email_id)
            .limit(1)
            .single();

          if (existingBundleEmail) {
            for (const bItem of bundle.items) {
              failed.push({
                email_id: bundle.email_id,
                set_number: bItem.set_number,
                order_reference: bundle.order_reference,
                error: 'Email already processed',
              });
            }
            continue;
          }

          // 1. Create 1 purchase for the bundle (total cost)
          const { data: bundlePurchase, error: bundlePurchaseError } = await supabase
            .from('purchases')
            .insert({
              user_id: userId,
              source: bundle.source,
              cost: bundle.total_cost,
              payment_method: bundle.payment_method,
              purchase_date: bundle.purchase_date,
              short_description: `Bundle: ${bundle.items.map(i => i.set_number).join(', ')}`,
              description: `Bundle of ${bundle.items.length} sets from ${bundle.seller_username || bundle.source}`,
              reference: bundle.order_reference,
            })
            .select('id')
            .single();

          if (bundlePurchaseError || !bundlePurchase) {
            await supabase.from('processed_purchase_emails').insert({
              email_id: bundle.email_id,
              source: bundle.source,
              order_reference: bundle.order_reference,
              status: 'failed',
              error_message: bundlePurchaseError?.message || 'Failed to create bundle purchase',
              email_subject: bundle.email_subject,
              email_date: bundle.email_date,
              item_name: bundle.items.map(i => i.set_name).join(', '),
              cost: bundle.total_cost,
              seller_username: bundle.seller_username,
            });
            for (const bItem of bundle.items) {
              failed.push({
                email_id: bundle.email_id,
                set_number: bItem.set_number,
                order_reference: bundle.order_reference,
                error: bundlePurchaseError?.message || 'Failed to create bundle purchase',
              });
            }
            continue;
          }

          // 2. Allocate costs proportionally by list_price, fallback to equal split
          const allHaveListPrice = bundle.items.every(i => i.list_price != null);
          let allocatedCosts: number[];

          if (allHaveListPrice) {
            const totalListPrice = bundle.items.reduce((sum, i) => sum + (i.list_price || 0), 0);
            allocatedCosts = bundle.items.map(i => {
              const proportion = (i.list_price || 0) / totalListPrice;
              return Math.round(proportion * bundle.total_cost * 100) / 100;
            });
          } else {
            const equalCost = Math.round((bundle.total_cost / bundle.items.length) * 100) / 100;
            allocatedCosts = bundle.items.map(() => equalCost);
          }
          // Fix rounding error on last item
          const allocatedSum = allocatedCosts.reduce((s, c) => s + c, 0);
          const diff = Math.round((bundle.total_cost - allocatedSum) * 100) / 100;
          allocatedCosts[allocatedCosts.length - 1] += diff;

          // 3. Create N inventory items
          const createdInventoryIds: string[] = [];
          let bundleCreateFailed = false;

          for (let i = 0; i < bundle.items.length; i++) {
            const bItem = bundle.items[i];
            const allocatedCost = allocatedCosts[i];

            // Generate SKU
            const skuPrefix = bItem.condition === 'New' ? 'N' : 'U';
            const { data: skuRows2 } = await supabase
              .from('inventory_items')
              .select('sku')
              .not('sku', 'is', null)
              .order('created_at', { ascending: false })
              .limit(200);

            let maxNum2 = 0;
            if (skuRows2) {
              for (const row of skuRows2) {
                const match = row.sku?.match(/^[NU](\d+)$/);
                if (match) {
                  const num = parseInt(match[1], 10);
                  if (num > maxNum2) maxNum2 = num;
                }
              }
            }
            const newSku2 = `${skuPrefix}${maxNum2 + 1}`;

            const storLoc = bItem.storage_location || storage_location || 'TBC';
            const { data: bundleInv, error: bundleInvError } = await supabase
              .from('inventory_items')
              .insert({
                user_id: userId,
                set_number: bItem.set_number,
                item_name: bItem.set_name,
                condition: bItem.condition,
                cost: allocatedCost,
                purchase_id: bundlePurchase.id,
                linked_lot: bundle.order_reference,
                source: bundle.source,
                purchase_date: bundle.purchase_date,
                listing_platform: 'amazon',
                storage_location: storLoc,
                amazon_asin: bItem.amazon_asin,
                listing_value: bItem.list_price,
                sku: newSku2,
                status: 'Not Yet Received',
                notes: `Auto-imported (bundle ${i + 1}/${bundle.items.length}). Seller: ${bundle.seller_username || 'unknown'}. https://mail.google.com/mail/u/0/#all/${bundle.email_id}`,
              })
              .select('id')
              .single();

            if (bundleInvError || !bundleInv) {
              bundleCreateFailed = true;
              break;
            }
            createdInventoryIds.push(bundleInv.id);
          }

          if (bundleCreateFailed) {
            // Rollback: delete all created inventory items and the purchase
            for (const invId of createdInventoryIds) {
              await supabase.from('inventory_items').delete().eq('id', invId);
            }
            await supabase.from('purchases').delete().eq('id', bundlePurchase.id);

            await supabase.from('processed_purchase_emails').insert({
              email_id: bundle.email_id,
              source: bundle.source,
              order_reference: bundle.order_reference,
              status: 'failed',
              error_message: 'Failed to create all inventory items in bundle',
              email_subject: bundle.email_subject,
              email_date: bundle.email_date,
              item_name: bundle.items.map(i => i.set_name).join(', '),
              cost: bundle.total_cost,
              seller_username: bundle.seller_username,
            });
            for (const bItem of bundle.items) {
              failed.push({
                email_id: bundle.email_id,
                set_number: bItem.set_number,
                order_reference: bundle.order_reference,
                error: 'Bundle creation failed (rolled back)',
              });
            }
            continue;
          }

          // 4. Record success - 1 processed_purchase_emails entry per bundle
          await supabase.from('processed_purchase_emails').insert({
            email_id: bundle.email_id,
            source: bundle.source,
            order_reference: bundle.order_reference,
            purchase_id: bundlePurchase.id,
            status: 'imported',
            email_subject: bundle.email_subject,
            email_date: bundle.email_date,
            item_name: bundle.items.map(i => `${i.set_number} ${i.set_name}`).join(', '),
            cost: bundle.total_cost,
            seller_username: bundle.seller_username,
          });

          // Add to results
          for (let i = 0; i < bundle.items.length; i++) {
            const bItem = bundle.items[i];
            const allocatedCost = allocatedCosts[i];

            let roiPercent: number | null = null;
            if (bItem.list_price && allocatedCost > 0) {
              const estimatedNetRevenue = bItem.list_price * 0.85;
              const profit = estimatedNetRevenue - allocatedCost;
              roiPercent = Math.round((profit / allocatedCost) * 100);
            }

            created.push({
              purchase_id: bundlePurchase.id,
              inventory_id: createdInventoryIds[i],
              email_id: bundle.email_id,
              set_number: bItem.set_number,
              set_name: bItem.set_name,
              cost: allocatedCost,
              list_price: bItem.list_price || null,
              roi_percent: roiPercent,
            });

            totalInvested += allocatedCost;
            if (bItem.list_price) {
              totalExpectedRevenue += bItem.list_price;
            }
          }
        } catch (err) {
          await supabase.from('processed_purchase_emails').insert({
            email_id: bundle.email_id,
            source: bundle.source,
            order_reference: bundle.order_reference,
            status: 'failed',
            error_message: err instanceof Error ? err.message : 'Unknown error',
            email_subject: bundle.email_subject,
            email_date: bundle.email_date,
            item_name: bundle.items.map(i => i.set_name).join(', '),
            cost: bundle.total_cost,
            seller_username: bundle.seller_username,
          });
          for (const bItem of bundle.items) {
            failed.push({
              email_id: bundle.email_id,
              set_number: bItem.set_number,
              order_reference: bundle.order_reference,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        }
      }

      // Process items to skip
      for (const skipItem of skip_items) {
        try {
          // Check if already processed
          const { data: existingEmail } = await supabase
            .from('processed_purchase_emails')
            .select('id')
            .eq('email_id', skipItem.email_id)
            .limit(1)
            .single();

          if (existingEmail) {
            // Already tracked, skip silently
            continue;
          }

          // Record as skipped
          await supabase.from('processed_purchase_emails').insert({
            email_id: skipItem.email_id,
            source: skipItem.source,
            order_reference: skipItem.order_reference,
            status: 'skipped',
            skip_reason: skipItem.skip_reason,
            email_subject: skipItem.email_subject,
            email_date: skipItem.email_date,
            item_name: skipItem.item_name,
            cost: skipItem.cost,
            seller_username: skipItem.seller_username,
          });

          skipped.push({
            email_id: skipItem.email_id,
            skip_reason: skipItem.skip_reason,
          });
        } catch (err) {
          console.error(`[batch-import] Failed to record skipped email ${skipItem.email_id}:`, err);
        }
      }

      // Calculate totals
      const totalEstimatedProfit = totalExpectedRevenue > 0
        ? Math.round(totalExpectedRevenue * 0.85 - totalInvested)
        : null;
      const overallRoi = totalInvested > 0 && totalEstimatedProfit
        ? Math.round((totalEstimatedProfit / totalInvested) * 100)
        : null;

      // If all items failed and nothing was skipped, return error
      if (created.length === 0 && failed.length > 0 && skipped.length === 0) {
        return NextResponse.json(
          {
            error: 'All items failed to import',
            failed,
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        {
          data: {
            created,
            failed: failed.length > 0 ? failed : undefined,
            skipped: skipped.length > 0 ? skipped : undefined,
            summary: {
              total_items: items.length,
              created_count: created.length,
              failed_count: failed.length,
              skipped_count: skipped.length,
              total_invested: totalInvested,
              total_expected_revenue: totalExpectedRevenue > 0 ? totalExpectedRevenue : null,
              estimated_profit: totalEstimatedProfit,
              overall_roi_percent: overallRoi,
            },
            automated,
          },
        },
        { status: 201 }
      );
    } catch (error) {
      console.error('[POST /api/service/purchases/batch-import] Error:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
