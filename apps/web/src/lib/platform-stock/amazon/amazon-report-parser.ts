/**
 * Amazon Report Parser
 *
 * Parses the GET_MERCHANT_LISTINGS_ALL_DATA report from Amazon.
 * The report is a tab-separated values (TSV) file with the following columns:
 *
 * item-name, item-description, listing-id, seller-sku, price, quantity,
 * open-date, product-id-type, item-note, item-condition, will-ship-internationally,
 * expedited-shipping, product-id, pending-quantity, fulfillment-channel,
 * merchant-shipping-group, status
 */

import type { AmazonListingData, ListingStatus } from '../types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Raw parsed listing from the Amazon report
 */
export interface ParsedAmazonListing {
  // Core fields
  sellerSku: string;
  asin: string;
  title: string;
  price: number | null;
  quantity: number;
  fulfillmentChannel: string | null;
  listingStatus: ListingStatus;

  // Extended Amazon fields
  amazonData: AmazonListingData;

  // Raw row for storage
  rawRow: Record<string, string>;
}

/**
 * Report parsing result
 */
export interface ParseReportResult {
  listings: ParsedAmazonListing[];
  totalRows: number;
  skippedRows: number;
  errors: string[];
}

// ============================================================================
// COLUMN MAPPINGS
// ============================================================================

/**
 * Expected column names in GET_MERCHANT_LISTINGS_ALL_DATA report
 * Note: Amazon uses lowercase with hyphens
 */
const COLUMN_NAMES = {
  itemName: 'item-name',
  itemDescription: 'item-description',
  listingId: 'listing-id',
  sellerSku: 'seller-sku',
  price: 'price',
  quantity: 'quantity',
  openDate: 'open-date',
  productIdType: 'product-id-type',
  itemNote: 'item-note',
  itemCondition: 'item-condition',
  willShipInternationally: 'will-ship-internationally',
  expeditedShipping: 'expedited-shipping',
  productId: 'product-id', // This is the ASIN
  pendingQuantity: 'pending-quantity',
  fulfillmentChannel: 'fulfillment-channel',
  merchantShippingGroup: 'merchant-shipping-group',
  status: 'status',
} as const;

// ============================================================================
// PARSER FUNCTIONS
// ============================================================================

/**
 * Parse GET_MERCHANT_LISTINGS_ALL_DATA TSV report
 *
 * @param content - Raw TSV content from the report
 * @returns Parsed listings with metadata
 */
export function parseAmazonListingsReport(content: string): ParseReportResult {
  const errors: string[] = [];
  const listings: ParsedAmazonListing[] = [];

  // Split into lines, handling different line endings
  const lines = content.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length < 2) {
    return {
      listings: [],
      totalRows: 0,
      skippedRows: 0,
      errors: ['Report is empty or has no data rows'],
    };
  }

  // Parse header line
  const headerLine = lines[0];
  const headers = headerLine.split('\t').map((h) => h.trim().toLowerCase());

  // Build column index map
  const columnMap = new Map<string, number>();
  headers.forEach((header, index) => {
    columnMap.set(header, index);
  });

  // Validate required columns exist
  const requiredColumns = [
    COLUMN_NAMES.sellerSku,
    COLUMN_NAMES.productId,
    COLUMN_NAMES.quantity,
  ];

  for (const col of requiredColumns) {
    if (!columnMap.has(col)) {
      errors.push(`Missing required column: ${col}`);
    }
  }

  if (errors.length > 0) {
    return {
      listings: [],
      totalRows: lines.length - 1,
      skippedRows: lines.length - 1,
      errors,
    };
  }

  // Helper to get column value
  const getColumn = (row: string[], columnName: string): string => {
    const index = columnMap.get(columnName);
    return index !== undefined ? (row[index] || '').trim() : '';
  };

  // Parse data rows
  let skippedRows = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      skippedRows++;
      continue;
    }

    try {
      const row = line.split('\t');

      // Build raw row object for storage
      const rawRow: Record<string, string> = {};
      headers.forEach((header, index) => {
        rawRow[header] = row[index] || '';
      });

      // Parse core fields
      const sellerSku = getColumn(row, COLUMN_NAMES.sellerSku);
      const asin = getColumn(row, COLUMN_NAMES.productId);

      // Skip rows without SKU or ASIN
      if (!sellerSku && !asin) {
        skippedRows++;
        continue;
      }

      const priceStr = getColumn(row, COLUMN_NAMES.price);
      const quantityStr = getColumn(row, COLUMN_NAMES.quantity);
      const pendingQuantityStr = getColumn(row, COLUMN_NAMES.pendingQuantity);

      const price = priceStr ? parseFloat(priceStr) : null;
      const quantity = quantityStr ? parseInt(quantityStr, 10) : 0;
      const pendingQuantity = pendingQuantityStr
        ? parseInt(pendingQuantityStr, 10)
        : null;

      // Parse status
      const status = getColumn(row, COLUMN_NAMES.status);
      const listingStatus = mapAmazonStatus(status);

      // Parse fulfillment channel
      const fulfillmentChannel = getColumn(
        row,
        COLUMN_NAMES.fulfillmentChannel
      );

      // Build Amazon-specific data
      const amazonData: AmazonListingData = {
        fnsku: null, // Not in this report
        productType: getColumn(row, COLUMN_NAMES.productIdType) || null,
        productIdType: getColumn(row, COLUMN_NAMES.productIdType) || null,
        itemCondition: mapItemCondition(
          getColumn(row, COLUMN_NAMES.itemCondition)
        ),
        itemNote: getColumn(row, COLUMN_NAMES.itemNote) || null,
        itemDescription: getColumn(row, COLUMN_NAMES.itemDescription) || null,
        openDate: getColumn(row, COLUMN_NAMES.openDate) || null,
        willShipInternationally: parseBoolean(
          getColumn(row, COLUMN_NAMES.willShipInternationally)
        ),
        expeditedShipping: parseBoolean(
          getColumn(row, COLUMN_NAMES.expeditedShipping)
        ),
        pendingQuantity,
        merchantShippingGroup:
          getColumn(row, COLUMN_NAMES.merchantShippingGroup) || null,
        listingId: getColumn(row, COLUMN_NAMES.listingId) || null,
      };

      listings.push({
        sellerSku,
        asin,
        title: getColumn(row, COLUMN_NAMES.itemName),
        price: isNaN(price!) ? null : price,
        quantity: isNaN(quantity) ? 0 : quantity,
        fulfillmentChannel: mapFulfillmentChannel(fulfillmentChannel),
        listingStatus,
        amazonData,
        rawRow,
      });
    } catch (error) {
      skippedRows++;
      errors.push(`Error parsing row ${i + 1}: ${error}`);
    }
  }

  console.log(
    `[AmazonReportParser] Parsed ${listings.length} listings, skipped ${skippedRows} rows`
  );

  return {
    listings,
    totalRows: lines.length - 1,
    skippedRows,
    errors,
  };
}

// ============================================================================
// MAPPING HELPERS
// ============================================================================

/**
 * Map Amazon status to normalized ListingStatus
 */
function mapAmazonStatus(status: string): ListingStatus {
  const normalizedStatus = status?.toLowerCase().trim();

  switch (normalizedStatus) {
    case 'active':
      return 'Active';
    case 'inactive':
      return 'Inactive';
    case 'incomplete':
      return 'Incomplete';
    case 'out of stock':
    case 'out-of-stock':
      return 'Out of Stock';
    default:
      return 'Unknown';
  }
}

/**
 * Map Amazon fulfillment channel to readable format
 *
 * Amazon uses:
 * - AMAZON_NA, AMAZON_EU, etc. for FBA
 * - DEFAULT for FBM (merchant fulfilled)
 */
function mapFulfillmentChannel(channel: string | null): string | null {
  if (!channel) return null;

  const normalizedChannel = channel.toUpperCase().trim();

  if (
    normalizedChannel.startsWith('AMAZON') ||
    normalizedChannel === 'AFN'
  ) {
    return 'FBA';
  }

  if (normalizedChannel === 'DEFAULT' || normalizedChannel === 'MFN') {
    return 'FBM';
  }

  return channel; // Return original if unknown
}

/**
 * Map Amazon item condition to readable format
 */
function mapItemCondition(condition: string): string | null {
  if (!condition) return null;

  const conditionMap: Record<string, string> = {
    '1': 'Used - Like New',
    '2': 'Used - Very Good',
    '3': 'Used - Good',
    '4': 'Used - Acceptable',
    '5': 'Collectible - Like New',
    '6': 'Collectible - Very Good',
    '7': 'Collectible - Good',
    '8': 'Collectible - Acceptable',
    '10': 'Refurbished',
    '11': 'New',
    new: 'New',
    used: 'Used',
    refurbished: 'Refurbished',
    collectible: 'Collectible',
  };

  const lowerCondition = condition.toLowerCase().trim();
  return conditionMap[lowerCondition] || condition;
}

/**
 * Parse Amazon boolean field (y/n or yes/no)
 */
function parseBoolean(value: string): boolean | null {
  if (!value) return null;

  const normalized = value.toLowerCase().trim();
  if (normalized === 'y' || normalized === 'yes' || normalized === 'true') {
    return true;
  }
  if (normalized === 'n' || normalized === 'no' || normalized === 'false') {
    return false;
  }
  return null;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get all column names from the report
 * Useful for building column visibility UI
 */
export function getReportColumns(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return [];

  const headerLine = lines[0];
  return headerLine.split('\t').map((h) => h.trim());
}

/**
 * Get a human-readable label for a column name
 */
export function getColumnLabel(columnName: string): string {
  const labels: Record<string, string> = {
    'item-name': 'Title',
    'item-description': 'Description',
    'listing-id': 'Listing ID',
    'seller-sku': 'SKU',
    price: 'Price',
    quantity: 'Quantity',
    'open-date': 'Open Date',
    'product-id-type': 'Product ID Type',
    'item-note': 'Item Note',
    'item-condition': 'Condition',
    'will-ship-internationally': 'Ships International',
    'expedited-shipping': 'Expedited',
    'product-id': 'ASIN',
    'pending-quantity': 'Pending Qty',
    'fulfillment-channel': 'Fulfillment',
    'merchant-shipping-group': 'Shipping Group',
    status: 'Status',
  };

  return (
    labels[columnName.toLowerCase()] ||
    columnName
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}
