import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateAuth } from '@/lib/api/validate-auth';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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

export interface AmazonPickingListItem {
  location: string | null;
  setNo: string | null;
  asin: string | null;
  itemName: string;
  orderId: string;
  orderItemId: string;
  amazonOrderId: string;
  quantity: number;
  buyerName: string | null;
  orderDate: string;
  matchStatus: 'matched' | 'unmatched';
  inventoryItemId: string | null;
}

export interface AmazonPickingListResponse {
  items: AmazonPickingListItem[];
  unmatchedItems: AmazonPickingListItem[];
  unknownLocationItems: AmazonPickingListItem[];
  totalItems: number;
  totalOrders: number;
  generatedAt: string;
}

/**
 * GET /api/picking-list/amazon
 * Get picking list data for unfulfilled Amazon orders
 */
export async function GET(request: NextRequest) {
  try {
    // Validate auth via API key or session cookie
    const auth = await validateAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createClient();
    const userId = auth.userId;

    // Check for format parameter (json or pdf)
    const format = request.nextUrl.searchParams.get('format') || 'json';

    // Fetch unfulfilled Amazon orders with line items
    // Unfulfilled = status is Unshipped, PartiallyShipped, or Pending
    const { data: orders, error } = await supabase
      .from('platform_orders')
      .select(
        `
        id,
        platform_order_id,
        buyer_name,
        order_date,
        status,
        fulfilled_at,
        items:order_items(
          id,
          item_number,
          item_name,
          quantity,
          inventory_item_id
        )
      `
      )
      .eq('user_id', userId)
      .eq('platform', 'amazon')
      .is('fulfilled_at', null)
      .in('status', ['Paid', 'Partially Shipped', 'Pending'])
      .order('order_date', { ascending: true });

    if (error) {
      console.error('[GET /api/picking-list/amazon] Error fetching orders:', error);
      return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
    }

    // Get all ASINs from order items
    const allAsins = new Set<string>();
    interface OrderWithItems {
      id: string;
      platform_order_id: string;
      buyer_name: string | null;
      order_date: string;
      status: string;
      fulfilled_at: string | null;
      items: Array<{
        id: string;
        item_number: string;
        item_name: string;
        quantity: number;
        inventory_item_id: string | null;
      }>;
    }

    (orders as OrderWithItems[] || []).forEach((order) => {
      order.items.forEach((item) => {
        if (item.item_number) {
          allAsins.add(item.item_number);
        }
      });
    });

    // Get inventory items by ASIN - fetch ALL matching items for FIFO selection
    // Filter: amazon_asin matches, listing_platform = 'amazon', status in (BACKLOG, LISTED)
    // Sort by created_at ascending for FIFO
    let inventoryByAsin: Array<{
      id: string;
      amazon_asin: string | null;
      set_number: string;
      item_name: string | null;
      storage_location: string | null;
      status: string | null;
      listing_platform: string | null;
      created_at: string;
    }> = [];

    if (allAsins.size > 0) {
      const { data } = await supabase
        .from('inventory_items')
        .select('id, amazon_asin, set_number, item_name, storage_location, status, listing_platform, created_at')
        .eq('user_id', userId)
        .in('amazon_asin', Array.from(allAsins))
        .ilike('listing_platform', '%amazon%')
        .in('status', ['BACKLOG', 'LISTED'])
        .order('created_at', { ascending: true }); // FIFO - oldest first
      inventoryByAsin = data || [];
    }

    // Get inventory IDs already linked to any order (to exclude from matching)
    const { data: linkedItems } = await supabase
      .from('order_items')
      .select('inventory_item_id')
      .not('inventory_item_id', 'is', null);

    const alreadyLinkedInventoryIds = new Set(
      (linkedItems ?? [])
        .map((item: { inventory_item_id: string | null }) => item.inventory_item_id)
        .filter((id): id is string => id !== null)
    );

    // Group inventory by ASIN (multiple items can have same ASIN)
    const inventoryByAsinMap = new Map<string, typeof inventoryByAsin>();
    for (const item of inventoryByAsin) {
      if (item.amazon_asin && !alreadyLinkedInventoryIds.has(item.id)) {
        const existing = inventoryByAsinMap.get(item.amazon_asin) || [];
        existing.push(item);
        inventoryByAsinMap.set(item.amazon_asin, existing);
      }
    }

    // Track which inventory items we've assigned in this batch (to handle duplicates)
    const assignedInventoryIds = new Set<string>();

    // Build picking list items and persist matches
    const pickingListItems: AmazonPickingListItem[] = [];
    const unmatchedItems: AmazonPickingListItem[] = [];
    const unknownLocationItems: AmazonPickingListItem[] = [];
    const matchesToPersist: Array<{ orderItemId: string; inventoryItemId: string }> = [];

    for (const order of (orders as OrderWithItems[] || [])) {
      for (const lineItem of order.items) {
        let matchStatus: 'matched' | 'unmatched' = 'unmatched';
        let location: string | null = null;
        let setNo: string | null = null;
        let inventoryItemId: string | null = null;

        // Check if already linked (from previous picking list generation)
        if (lineItem.inventory_item_id) {
          // Already linked - fetch the inventory details
          const { data: linkedInventory } = await supabase
            .from('inventory_items')
            .select('id, set_number, storage_location')
            .eq('id', lineItem.inventory_item_id)
            .single();

          if (linkedInventory) {
            matchStatus = 'matched';
            location = linkedInventory.storage_location;
            setNo = linkedInventory.set_number;
            inventoryItemId = linkedInventory.id;
          }
        } else if (lineItem.item_number) {
          // Try to match by ASIN - use FIFO selection
          const availableInventory = inventoryByAsinMap.get(lineItem.item_number) || [];

          // Find first unassigned inventory item
          for (const inv of availableInventory) {
            if (!assignedInventoryIds.has(inv.id)) {
              matchStatus = 'matched';
              location = inv.storage_location;
              setNo = inv.set_number;
              inventoryItemId = inv.id;
              assignedInventoryIds.add(inv.id);

              // Queue this match to be persisted
              matchesToPersist.push({
                orderItemId: lineItem.id,
                inventoryItemId: inv.id,
              });
              break;
            }
          }
        }

        const item: AmazonPickingListItem = {
          location,
          setNo,
          asin: lineItem.item_number,
          itemName: lineItem.item_name,
          orderId: order.id,
          orderItemId: lineItem.id,
          amazonOrderId: order.platform_order_id,
          quantity: lineItem.quantity,
          buyerName: order.buyer_name,
          orderDate: order.order_date,
          matchStatus,
          inventoryItemId,
        };

        // Track unmatched items
        if (matchStatus === 'unmatched') {
          unmatchedItems.push(item);
        }

        // Track items with unknown location (matched but no storage location set)
        if (matchStatus === 'matched' && !location) {
          unknownLocationItems.push(item);
        }

        pickingListItems.push(item);
      }
    }

    // Persist the matches to order_items table (creates the FK link for confirmation later)
    if (matchesToPersist.length > 0) {
      let persistedCount = 0;
      const persistErrors: string[] = [];

      for (const match of matchesToPersist) {
        const { error } = await supabase
          .from('order_items')
          .update({
            inventory_item_id: match.inventoryItemId,
          })
          .eq('id', match.orderItemId);

        if (error) {
          console.error(`[GET /api/picking-list/amazon] Failed to persist match for order item ${match.orderItemId}:`, error);
          persistErrors.push(`${match.orderItemId}: ${error.message}`);
        } else {
          persistedCount++;
        }
      }

      console.log(`[GET /api/picking-list/amazon] Persisted ${persistedCount}/${matchesToPersist.length} inventory matches`);
      if (persistErrors.length > 0) {
        console.error(`[GET /api/picking-list/amazon] Persist errors:`, persistErrors);
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

    const response: AmazonPickingListResponse = {
      items: pickingListItems,
      unmatchedItems,
      unknownLocationItems,
      totalItems: pickingListItems.reduce((sum, item) => sum + item.quantity, 0),
      totalOrders: (orders as OrderWithItems[])?.length || 0,
      generatedAt: new Date().toISOString(),
    };

    // If PDF format requested, generate PDF
    if (format === 'pdf') {
      const pdfArrayBuffer = generateAmazonPickingListPDF(response);

      return new NextResponse(pdfArrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="amazon-picking-list-${new Date().toISOString().split('T')[0]}.pdf"`,
        },
      });
    }

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error('[GET /api/picking-list/amazon] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Generate a PDF picking list using jsPDF
 */
function generateAmazonPickingListPDF(data: AmazonPickingListResponse): ArrayBuffer {
  const doc = new jsPDF();
  const date = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // Title
  doc.setFontSize(18);
  doc.text('Amazon Picking List', 14, 20);

  // Metadata
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated: ${date} | Total Items: ${data.totalItems} | Orders: ${data.totalOrders}`, 14, 28);

  // Check for warnings
  const hasWarnings = data.unmatchedItems.length > 0 || data.unknownLocationItems.length > 0;

  let startY = 35;
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxTextWidth = pageWidth - 40;

  // Helper function to wrap item text for warnings
  const wrapItemText = (item: AmazonPickingListItem): string[] => {
    const text = `• ${item.asin || 'No ASIN'}: ${item.itemName}`;
    return doc.splitTextToSize(text, maxTextWidth - 4);
  };

  // Warning section for unmatched items
  if (data.unmatchedItems.length > 0) {
    const headerLines = doc.splitTextToSize(
      `WARNING: ${data.unmatchedItems.length} item(s) have no inventory match - ensure ASIN is set in inventory`,
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
      `WARNING: ${data.unknownLocationItems.length} item(s) have no storage location set in inventory`,
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
  const itemsByLocation = new Map<string, AmazonPickingListItem[]>();
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
        item.setNo || item.asin || '-',
        item.itemName,
        item.amazonOrderId,
        item.quantity,
        '', // Checkbox column for manual ticking
      ]);
    }
  }

  // Create main table
  autoTable(doc, {
    startY,
    head: [['Set/ASIN', 'Item Name', 'Order ID', 'Qty', 'Picked']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 'auto', overflow: 'linebreak' },
      2: { cellWidth: 40 },
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
