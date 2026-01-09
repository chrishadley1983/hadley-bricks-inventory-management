import { NextResponse } from 'next/server';

const CSV_HEADERS = [
  'set_number',
  'item_name',
  'condition',
  'status',
  'cost',
  'source',
  'purchase_date',
  'storage_location',
  'listing_platform',
  'listing_date',
  'listing_value',
  'sku',
  'linked_lot',
  'amazon_asin',
  'notes',
];

const EXAMPLE_ROW = [
  '75192',
  'UCS Millennium Falcon',
  'New',
  'BACKLOG',
  '549.99',
  'LEGO Store',
  '2024-01-15',
  'Shelf A3',
  'eBay',
  '2024-01-20',
  '799.99',
  'HB-75192-001',
  'LOT-2024-01',
  'B0BV7V6F5K',
  'VIP double points',
];

/**
 * GET /api/inventory/template
 * Returns a CSV template for inventory import
 */
export async function GET() {
  const csvContent = [
    CSV_HEADERS.join(','),
    EXAMPLE_ROW.join(','),
  ].join('\n');

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="inventory-import-template.csv"',
    },
  });
}
