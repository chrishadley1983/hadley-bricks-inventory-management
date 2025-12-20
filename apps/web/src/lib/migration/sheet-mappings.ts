/**
 * Google Sheets to Supabase column mappings
 *
 * These mappings define how data from Google Sheets should be transformed
 * and stored in Supabase tables.
 */

/**
 * Column mapping definition
 */
export interface ColumnMapping {
  /** Column letter in the sheet (A, B, C, etc.) */
  sheetColumn: string;
  /** Column header name in the sheet */
  sheetHeader: string;
  /** Target field name in Supabase */
  supabaseField: string;
  /** Data type for transformation */
  type: 'string' | 'number' | 'date' | 'boolean' | 'currency';
  /** Whether this field is required */
  required?: boolean;
  /** Custom transform function */
  transform?: (value: string) => unknown;
}

/**
 * Sheet mapping configuration
 */
export interface SheetMapping {
  /** Name of the sheet in Google Sheets */
  sheetName: string;
  /** Target table in Supabase */
  supabaseTable: string;
  /** Column for identifying unique records (for deduplication) */
  uniqueKeyColumn: string;
  /** Column mappings */
  columns: ColumnMapping[];
}

/**
 * Parse a UK date string (DD/MM/YYYY) to ISO format (YYYY-MM-DD)
 */
export function parseUKDate(value: string): string | null {
  if (!value || value.trim() === '') return null;

  // Handle DD/MM/YYYY format
  const ukMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) {
    const [, day, month, year] = ukMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Handle DD-MMM-YY format (e.g., "15-Jan-24")
  const shortMatch = value.match(/^(\d{1,2})-(\w{3})-(\d{2})$/);
  if (shortMatch) {
    const [, day, monthStr, year] = shortMatch;
    const months: Record<string, string> = {
      Jan: '01',
      Feb: '02',
      Mar: '03',
      Apr: '04',
      May: '05',
      Jun: '06',
      Jul: '07',
      Aug: '08',
      Sep: '09',
      Oct: '10',
      Nov: '11',
      Dec: '12',
    };
    const month = months[monthStr];
    if (month) {
      const fullYear = parseInt(year) > 50 ? `19${year}` : `20${year}`;
      return `${fullYear}-${month}-${day.padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Parse a currency string (e.g., "£1,234.56") to a number
 */
export function parseCurrency(value: string): number | null {
  if (!value || value.trim() === '') return null;
  const cleaned = value.replace(/[£$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Parse a percentage string (e.g., "46.24%") to a decimal
 */
export function parsePercentage(value: string): number | null {
  if (!value || value.trim() === '') return null;
  const cleaned = value.replace(/[%\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num / 100;
}

/**
 * Normalize status values to match Supabase enum
 */
export function normalizeStatus(value: string): string {
  const statusMap: Record<string, string> = {
    SOLD: 'SOLD',
    LISTED: 'LISTED',
    'IN STOCK': 'IN STOCK',
    'NOT YET RECEIVED': 'NOT YET RECEIVED',
    // Common variations
    sold: 'SOLD',
    listed: 'LISTED',
    'in stock': 'IN STOCK',
    stock: 'IN STOCK',
    pending: 'NOT YET RECEIVED',
  };
  return statusMap[value] || statusMap[value.toLowerCase()] || 'IN STOCK';
}

/**
 * Normalize condition values
 */
export function normalizeCondition(value: string): 'New' | 'Used' {
  const lower = value.toLowerCase();
  if (lower.includes('new') || lower === 'n') return 'New';
  return 'Used';
}

// ============================================================================
// SHEET MAPPINGS
// ============================================================================

/**
 * Mapping for "Lego New Kit Inventory" sheet → inventory table
 */
export const newKitInventoryMapping: SheetMapping = {
  sheetName: 'Lego New Kit Inventory',
  supabaseTable: 'inventory_items',
  uniqueKeyColumn: 'A', // ID column (e.g., "N1", "N2")
  columns: [
    {
      sheetColumn: 'A',
      sheetHeader: 'ID',
      supabaseField: 'sku',
      type: 'string',
      required: true,
    },
    {
      sheetColumn: 'B',
      sheetHeader: 'Item',
      supabaseField: 'item_name',
      type: 'string',
    },
    {
      sheetColumn: 'C',
      sheetHeader: 'Set Number',
      supabaseField: 'set_number',
      type: 'string',
      required: true,
    },
    {
      sheetColumn: 'D',
      sheetHeader: 'Source',
      supabaseField: 'source',
      type: 'string',
    },
    {
      sheetColumn: 'E',
      sheetHeader: 'Linked Lots',
      supabaseField: 'linked_lot',
      type: 'string',
    },
    {
      sheetColumn: 'G',
      sheetHeader: 'Purchase Date',
      supabaseField: 'purchase_date',
      type: 'date',
      transform: parseUKDate,
    },
    {
      sheetColumn: 'L',
      sheetHeader: 'Total Cost',
      supabaseField: 'cost',
      type: 'currency',
      transform: parseCurrency,
    },
    {
      sheetColumn: 'O',
      sheetHeader: 'Notes',
      supabaseField: 'notes',
      type: 'string',
    },
    {
      sheetColumn: 'P',
      sheetHeader: 'Status',
      supabaseField: 'status',
      type: 'string',
      transform: normalizeStatus,
    },
    {
      sheetColumn: 'Q',
      sheetHeader: 'Listing Date',
      supabaseField: 'listing_date',
      type: 'date',
      transform: parseUKDate,
    },
    {
      sheetColumn: 'R',
      sheetHeader: 'Storage Location',
      supabaseField: 'storage_location',
      type: 'string',
      transform: (v) => (v === 'SOLD' ? null : v), // Clear if "SOLD"
    },
    {
      sheetColumn: 'S',
      sheetHeader: 'Listing Platform',
      supabaseField: 'listing_platform',
      type: 'string',
    },
    {
      sheetColumn: 'T',
      sheetHeader: 'Amazon ASIN',
      supabaseField: 'amazon_asin',
      type: 'string',
    },
    {
      sheetColumn: 'Y',
      sheetHeader: 'Sale Price',
      supabaseField: 'listing_value',
      type: 'currency',
      transform: parseCurrency,
    },
  ],
};

/**
 * Mapping for "Lego Used Kit Inventory" sheet → inventory table
 */
export const usedKitInventoryMapping: SheetMapping = {
  sheetName: 'Lego Used Kit Inventory',
  supabaseTable: 'inventory_items',
  uniqueKeyColumn: 'A', // ID column (e.g., "U1", "U2")
  columns: [
    {
      sheetColumn: 'A',
      sheetHeader: 'ID',
      supabaseField: 'sku',
      type: 'string',
      required: true,
    },
    {
      sheetColumn: 'B',
      sheetHeader: 'Item',
      supabaseField: 'item_name',
      type: 'string',
    },
    {
      sheetColumn: 'C',
      sheetHeader: 'Set Number',
      supabaseField: 'set_number',
      type: 'string',
      required: true,
    },
    {
      sheetColumn: 'D',
      sheetHeader: 'Source',
      supabaseField: 'source',
      type: 'string',
    },
    {
      sheetColumn: 'E',
      sheetHeader: 'Linked Lots',
      supabaseField: 'linked_lot',
      type: 'string',
    },
    {
      sheetColumn: 'F',
      sheetHeader: 'Purchase Date',
      supabaseField: 'purchase_date',
      type: 'date',
      transform: parseUKDate,
    },
    {
      sheetColumn: 'G',
      sheetHeader: 'Cost',
      supabaseField: 'cost',
      type: 'currency',
      transform: parseCurrency,
    },
    {
      sheetColumn: 'H',
      sheetHeader: 'Status',
      supabaseField: 'status',
      type: 'string',
      transform: normalizeStatus,
    },
    {
      sheetColumn: 'I',
      sheetHeader: 'Listing Date',
      supabaseField: 'listing_date',
      type: 'date',
      transform: parseUKDate,
    },
    {
      sheetColumn: 'J',
      sheetHeader: 'Storage Location',
      supabaseField: 'storage_location',
      type: 'string',
      transform: (v) => (v === 'SOLD' ? null : v),
    },
    {
      sheetColumn: 'K',
      sheetHeader: 'SKU',
      supabaseField: 'sku',
      type: 'string',
    },
    {
      sheetColumn: 'L',
      sheetHeader: 'Listing Notes',
      supabaseField: 'notes',
      type: 'string',
    },
    {
      sheetColumn: 'M',
      sheetHeader: 'Listing Value',
      supabaseField: 'listing_value',
      type: 'currency',
      transform: parseCurrency,
    },
  ],
};

/**
 * Mapping for "Purchases" sheet → purchases table
 */
export const purchasesMapping: SheetMapping = {
  sheetName: 'Purchases',
  supabaseTable: 'purchases',
  uniqueKeyColumn: 'A', // ID column
  columns: [
    {
      sheetColumn: 'A',
      sheetHeader: 'ID',
      supabaseField: 'sheets_id',
      type: 'string',
      required: true,
    },
    {
      sheetColumn: 'B',
      sheetHeader: 'Short Description',
      supabaseField: 'short_description',
      type: 'string',
      required: true,
    },
    {
      sheetColumn: 'C',
      sheetHeader: 'Cost',
      supabaseField: 'cost',
      type: 'currency',
      transform: parseCurrency,
    },
    {
      sheetColumn: 'D',
      sheetHeader: 'Date',
      supabaseField: 'purchase_date',
      type: 'date',
      transform: parseUKDate,
    },
    {
      sheetColumn: 'E',
      sheetHeader: 'Source',
      supabaseField: 'source',
      type: 'string',
    },
    {
      sheetColumn: 'F',
      sheetHeader: 'Payment Method',
      supabaseField: 'payment_method',
      type: 'string',
    },
    {
      sheetColumn: 'G',
      sheetHeader: 'Reference',
      supabaseField: 'reference',
      type: 'string',
    },
    {
      sheetColumn: 'H',
      sheetHeader: 'Description',
      supabaseField: 'description',
      type: 'string',
    },
  ],
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get all defined sheet mappings
 */
export function getAllMappings(): SheetMapping[] {
  return [newKitInventoryMapping, usedKitInventoryMapping, purchasesMapping];
}

/**
 * Get mapping by sheet name
 */
export function getMappingBySheetName(sheetName: string): SheetMapping | undefined {
  return getAllMappings().find((m) => m.sheetName === sheetName);
}

/**
 * Get mapping by Supabase table name
 */
export function getMappingsByTable(tableName: string): SheetMapping[] {
  return getAllMappings().filter((m) => m.supabaseTable === tableName);
}

/**
 * Transform a row from Google Sheets to Supabase format
 */
export function transformRow(
  row: Record<string, string>,
  mapping: SheetMapping
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const col of mapping.columns) {
    const value = row[col.sheetHeader];

    if (value === undefined || value === null || value === '') {
      if (col.required) {
        throw new Error(`Required field "${col.sheetHeader}" is missing`);
      }
      continue;
    }

    // Apply transform if defined
    if (col.transform) {
      result[col.supabaseField] = col.transform(value);
    } else {
      // Default transforms based on type
      switch (col.type) {
        case 'number':
          result[col.supabaseField] = parseCurrency(value);
          break;
        case 'currency':
          result[col.supabaseField] = parseCurrency(value);
          break;
        case 'date':
          result[col.supabaseField] = parseUKDate(value);
          break;
        case 'boolean':
          result[col.supabaseField] =
            value.toLowerCase() === 'yes' || value === '1' || value.toLowerCase() === 'true';
          break;
        default:
          result[col.supabaseField] = value;
      }
    }
  }

  return result;
}

/**
 * Add condition field based on which sheet the data came from
 */
export function addConditionFromSheet(
  data: Record<string, unknown>,
  sheetName: string
): Record<string, unknown> {
  if (sheetName === 'Lego New Kit Inventory') {
    return { ...data, condition: 'New' };
  } else if (sheetName === 'Lego Used Kit Inventory') {
    return { ...data, condition: 'Used' };
  }
  return data;
}
