import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface PickingListItem {
  location: string | null;
  setNo: string | null;
  itemName: string;
  orderId: string;
  ebayOrderId: string;
  quantity: number;
  buyerUsername: string;
  creationDate: string;
  matchStatus: 'matched' | 'unmatched' | 'manual';
}

export interface PickingListResponse {
  items: PickingListItem[];
  unmatchedItems: PickingListItem[];
  unknownLocationItems: PickingListItem[];
  totalItems: number;
  totalOrders: number;
  generatedAt: string;
}

/**
 * GET /api/picking-list/ebay
 * Get picking list data for unfulfilled eBay orders
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check for format parameter (json or pdf)
    const format = request.nextUrl.searchParams.get('format') || 'json';

    // Fetch eligible orders with line items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orders, error } = await (supabase as any)
      .from('ebay_orders')
      .select(
        `
        id,
        ebay_order_id,
        buyer_username,
        creation_date,
        order_fulfilment_status,
        order_payment_status,
        line_items:ebay_order_line_items(
          id,
          sku,
          title,
          quantity,
          fulfilment_status
        )
      `
      )
      .eq('user_id', user.id)
      .neq('order_payment_status', 'FULLY_REFUNDED')
      .order('creation_date', { ascending: true });

    if (error) {
      console.error('[GET /api/picking-list/ebay] Error fetching orders:', error);
      return NextResponse.json(
        { error: 'Failed to fetch orders' },
        { status: 500 }
      );
    }

    // Filter to only include orders with unfulfilled line items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eligibleOrders = (orders || []).filter((order: any) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      order.line_items.some((li: any) => li.fulfilment_status === 'NOT_STARTED')
    );

    // Get all SKUs from eligible line items
    const allSkus = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eligibleOrders.forEach((order: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      order.line_items.forEach((li: any) => {
        if (li.sku && li.fulfilment_status === 'NOT_STARTED') {
          allSkus.add(li.sku);
        }
      });
    });

    // Get SKU mappings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: skuMappings } = await (supabase as any)
      .from('ebay_sku_mappings')
      .select('ebay_sku, inventory_item_id')
      .eq('user_id', user.id);

    const mappingsMap = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (skuMappings || []).map((m: any) => [m.ebay_sku, m.inventory_item_id])
    );

    // Get inventory items by SKU
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let inventoryBySku: any[] = [];
    if (allSkus.size > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('inventory_items')
        .select('id, sku, set_number, item_name, storage_location')
        .eq('user_id', user.id)
        .in('sku', Array.from(allSkus));
      inventoryBySku = data || [];
    }

    const inventoryBySkuMap = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inventoryBySku.map((item: any) => [item.sku, item])
    );

    // Get inventory items by mapping IDs
    const mappingIds = Array.from(mappingsMap.values());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let inventoryById: any[] = [];
    if (mappingIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('inventory_items')
        .select('id, sku, set_number, item_name, storage_location')
        .eq('user_id', user.id)
        .in('id', mappingIds);
      inventoryById = data || [];
    }

    const inventoryByIdMap = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inventoryById.map((item: any) => [item.id, item])
    );

    // Build picking list items
    const pickingListItems: PickingListItem[] = [];
    const unmatchedItems: PickingListItem[] = [];
    const unknownLocationItems: PickingListItem[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const order of eligibleOrders) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const lineItem of order.line_items) {
        if (lineItem.fulfilment_status !== 'NOT_STARTED') continue;

        let matchStatus: 'matched' | 'unmatched' | 'manual' = 'unmatched';
        let location: string | null = null;
        let setNo: string | null = lineItem.sku;

        // Check manual mapping first
        if (lineItem.sku && mappingsMap.has(lineItem.sku)) {
          const inventoryId = mappingsMap.get(lineItem.sku);
          const inventory = inventoryByIdMap.get(inventoryId);
          if (inventory) {
            matchStatus = 'manual';
            location = inventory.storage_location;
            setNo = inventory.set_number || inventory.sku;
          }
        }

        // Check direct SKU match
        if (matchStatus === 'unmatched' && lineItem.sku) {
          const inventory = inventoryBySkuMap.get(lineItem.sku);
          if (inventory) {
            matchStatus = 'matched';
            location = inventory.storage_location;
            setNo = inventory.set_number || inventory.sku;
          }
        }

        const item: PickingListItem = {
          location,
          setNo,
          itemName: lineItem.title,
          orderId: order.id,
          ebayOrderId: order.ebay_order_id,
          quantity: lineItem.quantity,
          buyerUsername: order.buyer_username,
          creationDate: order.creation_date,
          matchStatus,
        };

        // Track unmatched items
        if (matchStatus === 'unmatched') {
          unmatchedItems.push(item);
        }

        // Track items with unknown location (matched but no storage location set)
        if (matchStatus !== 'unmatched' && !location) {
          unknownLocationItems.push(item);
        }

        pickingListItems.push(item);
      }
    }

    // Sort by location, then by set number
    pickingListItems.sort((a, b) => {
      const locA = a.location || 'ZZZ'; // Put null locations at end
      const locB = b.location || 'ZZZ';
      if (locA !== locB) return locA.localeCompare(locB);
      const setA = a.setNo || '';
      const setB = b.setNo || '';
      return setA.localeCompare(setB);
    });

    const response: PickingListResponse = {
      items: pickingListItems,
      unmatchedItems,
      unknownLocationItems,
      totalItems: pickingListItems.reduce((sum, item) => sum + item.quantity, 0),
      totalOrders: eligibleOrders.length,
      generatedAt: new Date().toISOString(),
    };

    // If PDF format requested, generate PDF
    if (format === 'pdf') {
      const pdfArrayBuffer = generatePickingListPDF(response);

      return new NextResponse(pdfArrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="ebay-picking-list-${new Date().toISOString().split('T')[0]}.pdf"`,
        },
      });
    }

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error('[GET /api/picking-list/ebay] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Generate a PDF picking list using jsPDF
 */
function generatePickingListPDF(data: PickingListResponse): ArrayBuffer {
  const doc = new jsPDF();
  const date = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // Title
  doc.setFontSize(18);
  doc.text('eBay Picking List', 14, 20);

  // Metadata
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated: ${date} | Total Items: ${data.totalItems} | Orders: ${data.totalOrders}`, 14, 28);

  // Check for warnings
  const hasWarnings = data.unmatchedItems.length > 0 || data.unknownLocationItems.length > 0;

  let startY = 35;
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxTextWidth = pageWidth - 40; // 20mm margin on each side

  // Helper function to wrap item text for warnings
  const wrapItemText = (item: PickingListItem): string[] => {
    const text = `• ${item.setNo || 'No SKU'}: ${item.itemName}`;
    return doc.splitTextToSize(text, maxTextWidth - 4);
  };

  // Warning section for unmatched items
  if (data.unmatchedItems.length > 0) {
    // Calculate total height needed
    const headerLines = doc.splitTextToSize(
      `WARNING: ${data.unmatchedItems.length} item(s) have no inventory match - go to Settings > eBay SKU Matching to resolve`,
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
    // Calculate total height needed
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
  const itemsByLocation = new Map<string, PickingListItem[]>();
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
    tableData.push([{ content: location, colSpan: 5, styles: { fontStyle: 'bold', fillColor: [232, 232, 232] } } as unknown as string]);

    // Add items for this location
    for (const item of items) {
      tableData.push([
        item.setNo || '-',
        item.itemName, // Full text - will wrap automatically
        item.ebayOrderId,
        item.quantity,
        '', // Checkbox column for manual ticking
      ]);
    }
  }

  // Create main table
  autoTable(doc, {
    startY,
    head: [['Set No', 'Item Name', 'Order ID', 'Qty', 'Picked']],
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
      2: { cellWidth: 35 },
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
