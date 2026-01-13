/**
 * Purchase Evaluator Parser
 *
 * Parses CSV and clipboard (TSV/CSV) input for purchase evaluation.
 * Handles duplicate detection and cost/quantity parsing.
 */

import type { EvaluationInputItem, ParseError, ParseResult } from './types';

// ============================================
// Column Name Mappings
// ============================================

/**
 * Known column name variations mapped to standard field names
 */
const COLUMN_MAPPINGS: Record<string, keyof EvaluationInputItem> = {
  // Set number variations
  set_number: 'setNumber',
  setnumber: 'setNumber',
  'set number': 'setNumber',
  'item code': 'setNumber',
  item_code: 'setNumber',
  itemcode: 'setNumber',
  'set #': 'setNumber',
  'set#': 'setNumber',
  set: 'setNumber',

  // Set name variations
  set_name: 'setName',
  setname: 'setName',
  'set name': 'setName',
  'item name': 'setName',
  item_name: 'setName',
  itemname: 'setName',
  name: 'setName',
  description: 'setName',

  // Condition variations
  condition: 'condition',
  cond: 'condition',
  status: 'condition',

  // Quantity variations
  quantity: 'quantity',
  qty: 'quantity',
  count: 'quantity',
  amount: 'quantity',

  // Cost variations
  cost: 'cost',
  price: 'cost',
  'unit cost': 'cost',
  unit_cost: 'cost',
  unitcost: 'cost',
  'original price': 'cost',
  original_price: 'cost',
  originalprice: 'cost',
};

// ============================================
// CSV Parsing Helpers
// ============================================

/**
 * Parse a single CSV/TSV line respecting quoted values
 */
function parseLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Push the last value
  values.push(current.trim());

  return values;
}

/**
 * Detect delimiter (tab or comma)
 */
function detectDelimiter(content: string): string {
  const firstLine = content.split('\n')[0] || '';
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return tabCount >= commaCount ? '\t' : ',';
}

/**
 * Map column headers to field names
 */
function mapHeaders(headers: string[]): Map<string, number> {
  const headerMap = new Map<string, number>();

  headers.forEach((header, index) => {
    const normalized = header.toLowerCase().trim();
    const fieldName = COLUMN_MAPPINGS[normalized];

    if (fieldName) {
      headerMap.set(fieldName, index);
    }
  });

  return headerMap;
}

// ============================================
// Condition Parsing
// ============================================

/**
 * Parse condition string to New/Used
 */
function parseCondition(value: string): 'New' | 'Used' | null {
  const normalized = value.toLowerCase().trim();

  if (normalized === 'new' || normalized === 'n' || normalized === 'sealed') {
    return 'New';
  }

  if (normalized === 'used' || normalized === 'u' || normalized === 'opened') {
    return 'Used';
  }

  return null;
}

// ============================================
// Main Parser
// ============================================

/**
 * Parse CSV/TSV content into evaluation input items
 *
 * @param content - Raw CSV or TSV content string
 * @returns Parsed items, errors, and metadata about the input
 */
export function parseEvaluationContent(content: string): ParseResult {
  const items: EvaluationInputItem[] = [];
  const errors: ParseError[] = [];

  // Split into lines and filter empty
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    errors.push({ row: 0, message: 'No data found in input' });
    return { items, errors, hasCostColumn: false, hasQuantityColumn: false };
  }

  // Detect delimiter
  const delimiter = detectDelimiter(content);

  // Parse header row
  const headers = parseLine(lines[0], delimiter);
  const headerMap = mapHeaders(headers);

  // Validate required columns
  if (!headerMap.has('setNumber')) {
    errors.push({
      row: 1,
      message: 'Missing required column: Set Number (or Item Code)',
    });
    return { items, errors, hasCostColumn: false, hasQuantityColumn: false };
  }

  if (!headerMap.has('condition')) {
    errors.push({
      row: 1,
      message: 'Missing required column: Condition',
    });
    return { items, errors, hasCostColumn: false, hasQuantityColumn: false };
  }

  const hasCostColumn = headerMap.has('cost');
  const hasQuantityColumn = headerMap.has('quantity');

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1;
    const values = parseLine(lines[i], delimiter);

    // Get set number (required)
    const setNumberIdx = headerMap.get('setNumber')!;
    const setNumber = values[setNumberIdx]?.trim();

    if (!setNumber) {
      errors.push({ row: rowNum, message: 'Missing set number' });
      continue;
    }

    // Get condition (required)
    const conditionIdx = headerMap.get('condition')!;
    const conditionRaw = values[conditionIdx]?.trim() || '';
    const condition = parseCondition(conditionRaw);

    if (!condition) {
      errors.push({
        row: rowNum,
        message: `Invalid condition: "${conditionRaw}". Must be "New" or "Used"`,
      });
      continue;
    }

    // Get optional fields
    const item: EvaluationInputItem = {
      setNumber,
      condition,
    };

    // Set name (optional)
    const setNameIdx = headerMap.get('setName');
    if (setNameIdx !== undefined && values[setNameIdx]) {
      item.setName = values[setNameIdx].trim();
    }

    // Quantity (optional)
    const quantityIdx = headerMap.get('quantity');
    if (quantityIdx !== undefined && values[quantityIdx]) {
      const qty = parseInt(values[quantityIdx].trim(), 10);
      if (!isNaN(qty) && qty > 0) {
        item.quantity = qty;
      }
    }

    // Cost (optional)
    const costIdx = headerMap.get('cost');
    if (costIdx !== undefined && values[costIdx]) {
      // Remove currency symbols and parse
      const costStr = values[costIdx]
        .trim()
        .replace(/[£$€,]/g, '')
        .trim();
      const cost = parseFloat(costStr);
      if (!isNaN(cost) && cost >= 0) {
        item.cost = cost;
      }
    }

    items.push(item);
  }

  return { items, errors, hasCostColumn, hasQuantityColumn };
}

// ============================================
// Duplicate Detection
// ============================================

/**
 * Consolidate duplicate items (same set number + condition) into quantities
 *
 * @param items - Parsed items that may contain duplicates
 * @returns Consolidated items with quantities
 */
export function consolidateDuplicates(items: EvaluationInputItem[]): EvaluationInputItem[] {
  const itemMap = new Map<string, EvaluationInputItem>();

  for (const item of items) {
    // Create a key from set number + condition
    const key = `${item.setNumber}|${item.condition}`;

    const existing = itemMap.get(key);

    if (existing) {
      // Increment quantity
      const existingQty = existing.quantity ?? 1;
      const newQty = item.quantity ?? 1;
      existing.quantity = existingQty + newQty;

      // Handle cost averaging if both have costs
      if (existing.cost !== undefined && item.cost !== undefined) {
        // Weight by quantity
        const existingTotalCost = existing.cost * existingQty;
        const newTotalCost = item.cost * newQty;
        existing.cost = (existingTotalCost + newTotalCost) / existing.quantity;
      } else if (item.cost !== undefined) {
        existing.cost = item.cost;
      }

      // Keep longer name
      if (item.setName && (!existing.setName || item.setName.length > existing.setName.length)) {
        existing.setName = item.setName;
      }
    } else {
      // Clone item to avoid mutation
      itemMap.set(key, { ...item });
    }
  }

  return Array.from(itemMap.values());
}

// ============================================
// Full Parse Pipeline
// ============================================

/**
 * Parse content and consolidate duplicates
 *
 * This is the main entry point for parsing purchase evaluation input.
 *
 * @param content - Raw CSV or TSV content
 * @returns Fully processed parse result with duplicates consolidated
 */
export function parseAndConsolidate(content: string): ParseResult {
  const result = parseEvaluationContent(content);

  // If there are items and no quantity column, consolidate duplicates
  if (result.items.length > 0 && !result.hasQuantityColumn) {
    result.items = consolidateDuplicates(result.items);
  }

  return result;
}

// ============================================
// Template Generation
// ============================================

/**
 * Generate a CSV template for purchase evaluation
 */
export function generateTemplate(): string {
  const headers = ['Item Code', 'Item Name', 'Condition', 'Quantity', 'Cost'];
  const sampleRow = ['75192', 'Millennium Falcon', 'New', '1', '50.00'];

  return [headers.join(','), sampleRow.join(',')].join('\n');
}
