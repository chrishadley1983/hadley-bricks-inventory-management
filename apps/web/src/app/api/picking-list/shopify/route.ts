import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ShopifyOrder, ShopifyOrderLineItem } from '@/lib/shopify/types';

/**
 * Natural sort comparison for strings with numeric suffixes
 * e.g., "Loft - S5" comes before "Loft - S49"
 */
function naturalCompare(a: string, b: string): number {
  const regex = /(\d+)|(\D+)/g;
  const aParts = a.match(regex) || [];
  const bParts = b.match(regex) || [];

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || '';
    const bPart = bParts[i] || '';

    // If both parts are numeric, compare as numbers
    const aNum = parseInt(aPart, 10);
    const bNum = parseInt(bPart, 10);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum !== bNum) return aNum - bNum;
    } else {
      // Otherwise compare as strings
      const cmp = aPart.localeCompare(bPart);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

const HEX8 = /^[0-9a-f]{8}$/;

export interface ShopifyPickingListItem {
  location: string | null;
  setNo: string | null;
  sku: string | null;
  itemName: string;
  orderId: string;
  shopifyOrderId: string;
  orderName: string;
  quantity: number;
  buyerName: string | null;
  orderDate: string;
  matchStatus: 'matched' | 'unmatched';
  inventoryItemId: string | null;
}

export interface ShopifyPickingListResponse {
  items: ShopifyPickingListItem[];
  unmatchedItems: ShopifyPickingListItem[];
  unknownLocationItems: ShopifyPickingListItem[];
  totalItems: number;
  totalOrders: number;
  generatedAt: string;
  pickUrl?: string;
}

interface SoldInventoryItem {
  id: string;
  sku: string | null;
  set_number: string | null;
  item_name: string | null;
  storage_location: string | null;
  archive_location: string | null;
  sold_order_id: string | null;
}

/**
 * The Shopify order sync marks matched stock SOLD at ingestion and moves
 * `storage_location` into `archive_location` as
 * `SOLD-YYYYMMDD-<location> (shopify #1234)`. Recover the pick location
 * from that stamp (or from `storage_location` if it hasn't been moved yet).
 */
function resolvePickLocation(item: SoldInventoryItem): string | null {
  if (item.storage_location) return item.storage_location;
  if (!item.archive_location) return null;
  const match = item.archive_location.match(/^SOLD-\d{8}-(.+) \(shopify [^)]*\)$/);
  return match ? match[1] : null;
}

/**
 * Shopify variant SKUs can carry a manually-added location suffix, e.g.
 * "N3159 | Loft - S72 + Loft - S75" (multiple locations joined with " + "
 * when a variant's units are spread across locations). Inventory only knows
 * the base SKU before the pipe; the suffix doubles as a pick-location hint.
 */
function parseCompositeSku(rawSku: string | null | undefined): {
  baseSku: string | null;
  locationHint: string | null;
} {
  const sku = rawSku?.trim() || null;
  if (!sku) return { baseSku: null, locationHint: null };
  const idx = sku.indexOf(' | ');
  if (idx === -1) return { baseSku: sku, locationHint: null };
  return {
    baseSku: sku.slice(0, idx).trim() || null,
    locationHint: sku.slice(idx + 3).trim() || null,
  };
}

/**
 * GET /api/picking-list/shopify
 * Get picking list data for unfulfilled Shopify orders
 */
export async function GET(request: NextRequest) {
  try {
    // Validate auth via API key or session cookie
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role client for API key auth (bypasses RLS)
    // Use regular client for cookie auth (respects RLS)
    const isApiKeyAuth = !!request.headers.get('x-api-key');
    const supabase = isApiKeyAuth ? createServiceRoleClient() : await createClient();
    const userId = auth.userId;

    // Check for format parameter (json or pdf)
    const format = request.nextUrl.searchParams.get('format') || 'json';

    // Fetch unfulfilled Shopify orders. The sync writes status = 'Completed' once
    // Shopify reports fulfillment_status 'fulfilled'; before that it holds the raw
    // (lowercase) financial_status, e.g. 'paid'. `fulfilled_at` is never set for
    // Shopify so it cannot be the discriminator here. Line items live in raw_data
    // (there are no order_items rows for Shopify orders).
    const { data: orders, error } = await supabase
      .from('platform_orders')
      .select('id, platform_order_id, buyer_name, order_date, status, raw_data')
      .eq('user_id', userId)
      .eq('platform', 'shopify')
      .neq('status', 'Completed')
      .order('order_date', { ascending: true });

    if (error) {
      console.error('[GET /api/picking-list/shopify] Error fetching orders:', error);
      return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
    }

    interface ShopifyOrderRow {
      id: string;
      platform_order_id: string;
      buyer_name: string | null;
      order_date: string;
      status: string | null;
      raw_data: ShopifyOrder | null;
    }

    // Exclude dead orders (refunded/voided) — the sync only ingests paid orders,
    // but a later refund updates the stored financial_status.
    const DEAD_STATUSES = new Set(['refunded', 'voided', 'cancelled']);
    const openOrders = ((orders ?? []) as unknown as ShopifyOrderRow[]).filter(
      (o) => !DEAD_STATUSES.has((o.status ?? '').toLowerCase())
    );

    // Fetch the inventory items the order sync already resolved + marked SOLD for
    // these orders — they carry the pick location (inside archive_location).
    const orderIds = openOrders.map((o) => o.platform_order_id);
    let soldItems: SoldInventoryItem[] = [];
    if (orderIds.length > 0) {
      const { data } = await supabase
        .from('inventory_items')
        .select('id, sku, set_number, item_name, storage_location, archive_location, sold_order_id')
        .eq('user_id', userId)
        .eq('sold_platform', 'shopify')
        .in('sold_order_id', orderIds);
      soldItems = (data ?? []) as SoldInventoryItem[];
    }

    const soldByOrder = new Map<string, SoldInventoryItem[]>();
    for (const item of soldItems) {
      if (!item.sold_order_id) continue;
      const existing = soldByOrder.get(item.sold_order_id) || [];
      existing.push(item);
      soldByOrder.set(item.sold_order_id, existing);
    }

    // Fallback stock for lines the order sync could not resolve (e.g. orders
    // ingested while composite "SKU | location" variants defeated the SKU
    // match): LISTED inventory by base SKU, FIFO by created_at.
    const baseSkus = new Set<string>();
    for (const order of openOrders) {
      for (const li of order.raw_data?.line_items ?? []) {
        const { baseSku } = parseCompositeSku(li.sku);
        if (baseSku && !HEX8.test(baseSku)) baseSkus.add(baseSku);
      }
    }
    const listedBySku = new Map<string, SoldInventoryItem[]>();
    if (baseSkus.size > 0) {
      const { data } = await supabase
        .from('inventory_items')
        .select('id, sku, set_number, item_name, storage_location, archive_location, sold_order_id')
        .eq('user_id', userId)
        .eq('status', 'LISTED')
        .in('sku', Array.from(baseSkus))
        .order('created_at', { ascending: true });
      for (const item of (data ?? []) as SoldInventoryItem[]) {
        if (!item.sku) continue;
        const existing = listedBySku.get(item.sku) || [];
        existing.push(item);
        listedBySku.set(item.sku, existing);
      }
    }

    const pickingListItems: ShopifyPickingListItem[] = [];
    const unmatchedItems: ShopifyPickingListItem[] = [];
    const unknownLocationItems: ShopifyPickingListItem[] = [];
    const usedInventoryIds = new Set<string>();

    for (const order of openOrders) {
      const raw = order.raw_data;
      if (!raw?.line_items?.length) continue;

      // Net off refunded units per line (same rule as the order sync).
      const refundedByLine = new Map<number, number>();
      for (const refund of raw.refunds ?? []) {
        for (const rli of refund.refund_line_items ?? []) {
          refundedByLine.set(
            rli.line_item_id,
            (refundedByLine.get(rli.line_item_id) ?? 0) + (rli.quantity || 0)
          );
        }
      }

      const orderSoldItems = soldByOrder.get(order.platform_order_id) || [];

      for (const lineItem of raw.line_items as ShopifyOrderLineItem[]) {
        const effQty = Math.max(
          0,
          (lineItem.quantity || 0) - (refundedByLine.get(lineItem.id) ?? 0)
        );
        if (effQty <= 0) continue; // fully refunded

        const { baseSku, locationHint } = parseCompositeSku(lineItem.sku);

        // Tier 1 — inventory items the sync already resolved + marked SOLD for
        // this order: by base SKU, or by 8-hex id prefix for SKU-less items.
        const lineInventory = orderSoldItems.filter((inv) => {
          if (usedInventoryIds.has(inv.id)) return false;
          if (baseSku && inv.sku === baseSku) return true;
          if (baseSku && HEX8.test(baseSku) && String(inv.id).startsWith(baseSku)) return true;
          return false;
        });

        const matched = lineInventory.slice(0, effQty);
        matched.forEach((inv) => usedInventoryIds.add(inv.id));

        // Tier 2 — LISTED inventory by base SKU for units the sync missed.
        let remaining = effQty - matched.length;
        if (remaining > 0 && baseSku) {
          const listedCandidates = (listedBySku.get(baseSku) ?? []).filter(
            (inv) => !usedInventoryIds.has(inv.id)
          );
          for (const inv of listedCandidates.slice(0, remaining)) {
            matched.push(inv);
            usedInventoryIds.add(inv.id);
            remaining--;
          }
        }

        const baseItem = {
          sku: baseSku,
          itemName: lineItem.title,
          orderId: order.id,
          shopifyOrderId: order.platform_order_id,
          orderName: raw.name || order.platform_order_id,
          buyerName: order.buyer_name,
          orderDate: order.order_date,
        };

        // One pick row per matched inventory unit — units of the same line can
        // live in different storage locations.
        for (const inv of matched) {
          const location = resolvePickLocation(inv);
          const item: ShopifyPickingListItem = {
            ...baseItem,
            location,
            setNo: inv.set_number,
            quantity: 1,
            matchStatus: 'matched',
            inventoryItemId: inv.id,
          };
          if (!location) unknownLocationItems.push(item);
          pickingListItems.push(item);
        }

        // Tier 3 — units with no inventory match at all. Fall back to the
        // location hint embedded in the variant SKU, if there is one.
        if (remaining > 0) {
          const item: ShopifyPickingListItem = {
            ...baseItem,
            location: locationHint,
            setNo: null,
            quantity: remaining,
            matchStatus: 'unmatched',
            inventoryItemId: null,
          };
          unmatchedItems.push(item);
          pickingListItems.push(item);
        }
      }
    }

    // Sort by location (natural sort for numeric suffixes), then by set number
    pickingListItems.sort((a, b) => {
      const locA = a.location || 'ZZZ'; // Put null locations at end
      const locB = b.location || 'ZZZ';
      if (locA !== locB) return naturalCompare(locA, locB);
      const setA = a.setNo || '';
      const setB = b.setNo || '';
      return setA.localeCompare(setB);
    });

    const generatedAt = new Date().toISOString();
    const response: ShopifyPickingListResponse = {
      items: pickingListItems,
      unmatchedItems,
      unknownLocationItems,
      totalItems: pickingListItems.reduce((sum, item) => sum + item.quantity, 0),
      totalOrders: openOrders.length,
      generatedAt,
      pickUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://hadley-bricks-inventory-management.vercel.app'}/pick/shopify`,
    };

    // Save snapshot for interactive pick list page (fire-and-forget)
    const serviceClient = createServiceRoleClient();
    serviceClient
      .from('picklist_snapshots')
      .insert({
        platform: 'shopify' as const,
        data: JSON.parse(JSON.stringify(response)),
        generated_at: generatedAt,
        user_id: userId,
      })
      .then(({ error: snapError }) => {
        if (snapError) {
          console.error('[GET /api/picking-list/shopify] Failed to save snapshot:', snapError);
          return;
        }
        // Clean up old snapshots, keep only the latest
        serviceClient
          .from('picklist_snapshots')
          .delete()
          .eq('user_id', userId)
          .eq('platform', 'shopify')
          .lt('generated_at', generatedAt)
          .then(({ error: cleanupError }) => {
            if (cleanupError) {
              console.error(
                '[GET /api/picking-list/shopify] Failed to clean old snapshots:',
                cleanupError
              );
            }
          });
      });

    // If PDF format requested, generate PDF
    if (format === 'pdf') {
      const pdfArrayBuffer = generateShopifyPickingListPDF(response);

      return new NextResponse(pdfArrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="shopify-picking-list-${new Date().toISOString().split('T')[0]}.pdf"`,
        },
      });
    }

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error('[GET /api/picking-list/shopify] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Generate a PDF picking list using jsPDF
 */
function generateShopifyPickingListPDF(data: ShopifyPickingListResponse): ArrayBuffer {
  const doc = new jsPDF();
  const date = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // Title
  doc.setFontSize(18);
  doc.text('Shopify Picking List', 14, 20);

  // Metadata
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(
    `Generated: ${date} | Total Items: ${data.totalItems} | Orders: ${data.totalOrders}`,
    14,
    28
  );

  // Check for warnings
  const hasWarnings = data.unmatchedItems.length > 0 || data.unknownLocationItems.length > 0;

  let startY = 35;
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxTextWidth = pageWidth - 40;

  // Helper function to wrap item text for warnings
  const wrapItemText = (item: ShopifyPickingListItem): string[] => {
    const text = `• ${item.sku || 'No SKU'}: ${item.itemName}`;
    return doc.splitTextToSize(text, maxTextWidth - 4);
  };

  // Warning section for unmatched items
  if (data.unmatchedItems.length > 0) {
    const headerLines = doc.splitTextToSize(
      `WARNING: ${data.unmatchedItems.length} item(s) have no inventory match - ensure the inventory SKU matches the Shopify variant SKU`,
      maxTextWidth
    );
    const itemLines = data.unmatchedItems.flatMap(wrapItemText);
    const totalHeight = 8 + headerLines.length * 4 + itemLines.length * 4;

    doc.setFillColor(255, 243, 205);
    doc.setDrawColor(255, 193, 7);
    doc.roundedRect(14, startY, pageWidth - 28, totalHeight, 2, 2, 'FD');

    doc.setTextColor(133, 100, 4);
    doc.setFontSize(9);
    doc.text(headerLines, 18, startY + 5);

    doc.setFontSize(8);
    let itemY = startY + 5 + headerLines.length * 4;
    data.unmatchedItems.forEach((item) => {
      const lines = wrapItemText(item);
      doc.text(lines, 20, itemY);
      itemY += lines.length * 4;
    });

    startY += totalHeight + 4;
  }

  // Warning section for unknown location items
  if (data.unknownLocationItems.length > 0) {
    const headerLines = doc.splitTextToSize(
      `WARNING: ${data.unknownLocationItems.length} item(s) have no storage location recorded`,
      maxTextWidth
    );
    const itemLines = data.unknownLocationItems.flatMap(wrapItemText);
    const totalHeight = 8 + headerLines.length * 4 + itemLines.length * 4;

    doc.setFillColor(255, 243, 205);
    doc.setDrawColor(255, 193, 7);
    doc.roundedRect(14, startY, pageWidth - 28, totalHeight, 2, 2, 'FD');

    doc.setTextColor(133, 100, 4);
    doc.setFontSize(9);
    doc.text(headerLines, 18, startY + 5);

    doc.setFontSize(8);
    let itemY = startY + 5 + headerLines.length * 4;
    data.unknownLocationItems.forEach((item) => {
      const lines = wrapItemText(item);
      doc.text(lines, 20, itemY);
      itemY += lines.length * 4;
    });

    startY += totalHeight + 4;
  }

  // Add some space if there were warnings
  if (hasWarnings) {
    startY += 3;
  }

  // Group items by location
  const itemsByLocation = new Map<string, ShopifyPickingListItem[]>();
  for (const item of data.items) {
    const loc = item.location || 'Unknown Location';
    if (!itemsByLocation.has(loc)) {
      itemsByLocation.set(loc, []);
    }
    itemsByLocation.get(loc)!.push(item);
  }

  // Build table data with location headers
  const tableData: (string | number)[][] = [];

  for (const [location, items] of itemsByLocation) {
    // Add location header as a row
    tableData.push([
      {
        content: location,
        colSpan: 5,
        styles: { fontStyle: 'bold', fillColor: [232, 232, 232] },
      } as unknown as string,
    ]);

    // Add items for this location
    for (const item of items) {
      tableData.push([
        item.setNo || item.sku || '-',
        item.itemName,
        item.orderName,
        item.quantity,
        '', // Checkbox column for manual ticking
      ]);
    }
  }

  // Create main table
  autoTable(doc, {
    startY,
    head: [['Set/SKU', 'Item Name', 'Order', 'Qty', 'Picked']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 'auto', overflow: 'linebreak' },
      2: { cellWidth: 30 },
      3: { cellWidth: 15, halign: 'center' },
      4: { cellWidth: 20, halign: 'center' },
    },
    styles: {
      fontSize: 9,
      cellPadding: 3,
      overflow: 'linebreak',
    },
    didParseCell: (data) => {
      // Style location header rows differently
      if (data.row.raw && Array.isArray(data.row.raw) && data.row.raw.length === 1) {
        data.cell.styles.fillColor = [232, 232, 232];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // Return as ArrayBuffer
  return doc.output('arraybuffer');
}
