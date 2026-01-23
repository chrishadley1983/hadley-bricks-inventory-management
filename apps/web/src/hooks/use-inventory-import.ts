'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SELLING_PLATFORMS, type SellingPlatform } from '@hadley-bricks/database';
import { inventoryKeys } from './use-inventory';

interface ImportItem {
  set_number: string;
  item_name?: string;
  condition?: 'New' | 'Used';
  status?: string;
  cost?: number;
  source?: string;
  purchase_date?: string;
  storage_location?: string;
  listing_platform?: string;
  listing_date?: string;
  listing_value?: number;
  sku?: string;
  linked_lot?: string;
  amazon_asin?: string;
  notes?: string;
}

interface ImportResponse {
  data: Array<{ id: string }>;
}

/**
 * Import multiple inventory items
 */
async function importInventory(items: ImportItem[]): Promise<ImportResponse> {
  const response = await fetch('/api/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to import inventory');
  }

  return response.json();
}

/**
 * Hook to import inventory items from CSV
 */
export function useInventoryImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (items: ImportItem[]) => importInventory(items),
    onSuccess: () => {
      // Invalidate inventory queries to refresh the list
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

/**
 * Parse CSV content into import items
 */
export function parseCsvContent(content: string): {
  items: ImportItem[];
  errors: Array<{ row: number; message: string }>;
} {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);

  if (lines.length < 2) {
    return { items: [], errors: [{ row: 0, message: 'CSV must have a header row and at least one data row' }] };
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const items: ImportItem[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  // Find column indices
  const colMap: Record<string, number> = {};
  headers.forEach((header, index) => {
    colMap[header] = index;
  });

  // Required column check
  if (colMap['set_number'] === undefined) {
    errors.push({ row: 1, message: 'Missing required column: set_number' });
    return { items, errors };
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const rowNum = i + 1;

    const setNumber = values[colMap['set_number']]?.trim();
    if (!setNumber) {
      errors.push({ row: rowNum, message: 'set_number is required' });
      continue;
    }

    const item: ImportItem = {
      set_number: setNumber,
    };

    // Optional fields
    if (colMap['item_name'] !== undefined && values[colMap['item_name']]) {
      item.item_name = values[colMap['item_name']].trim();
    }

    if (colMap['condition'] !== undefined && values[colMap['condition']]) {
      const condition = values[colMap['condition']].trim();
      if (condition === 'New' || condition === 'Used') {
        item.condition = condition;
      } else if (condition) {
        errors.push({ row: rowNum, message: `Invalid condition: ${condition}. Must be "New" or "Used"` });
        continue;
      }
    }

    if (colMap['status'] !== undefined && values[colMap['status']]) {
      const status = values[colMap['status']].trim().toUpperCase();
      const validStatuses = ['NOT YET RECEIVED', 'BACKLOG', 'LISTED', 'SOLD'];
      if (validStatuses.includes(status)) {
        item.status = status;
      } else if (values[colMap['status']].trim()) {
        errors.push({ row: rowNum, message: `Invalid status: ${values[colMap['status']]}` });
        continue;
      }
    }

    if (colMap['cost'] !== undefined && values[colMap['cost']]) {
      const cost = parseFloat(values[colMap['cost']].trim());
      if (!isNaN(cost) && cost >= 0) {
        item.cost = cost;
      } else if (values[colMap['cost']].trim()) {
        errors.push({ row: rowNum, message: `Invalid cost: ${values[colMap['cost']]}` });
        continue;
      }
    }

    if (colMap['source'] !== undefined && values[colMap['source']]) {
      item.source = values[colMap['source']].trim();
    }

    if (colMap['purchase_date'] !== undefined && values[colMap['purchase_date']]) {
      const date = values[colMap['purchase_date']].trim();
      // Basic date validation (YYYY-MM-DD format)
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        item.purchase_date = date;
      } else if (date) {
        errors.push({ row: rowNum, message: `Invalid date format: ${date}. Use YYYY-MM-DD` });
        continue;
      }
    }

    if (colMap['storage_location'] !== undefined && values[colMap['storage_location']]) {
      item.storage_location = values[colMap['storage_location']].trim();
    }

    if (colMap['listing_platform'] !== undefined && values[colMap['listing_platform']]) {
      const platform = values[colMap['listing_platform']].trim().toLowerCase();
      // Validate against allowed selling platforms
      if (SELLING_PLATFORMS.includes(platform as SellingPlatform)) {
        item.listing_platform = platform;
      } else if (platform) {
        errors.push({
          row: rowNum,
          message: `Invalid listing_platform: "${platform}". Must be one of: ${SELLING_PLATFORMS.join(', ')}`,
        });
        continue;
      }
    }

    if (colMap['listing_date'] !== undefined && values[colMap['listing_date']]) {
      const date = values[colMap['listing_date']].trim();
      // Basic date validation (YYYY-MM-DD format)
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        item.listing_date = date;
      } else if (date) {
        errors.push({ row: rowNum, message: `Invalid listing_date format: ${date}. Use YYYY-MM-DD` });
        continue;
      }
    }

    if (colMap['listing_value'] !== undefined && values[colMap['listing_value']]) {
      const value = parseFloat(values[colMap['listing_value']].trim());
      if (!isNaN(value) && value >= 0) {
        item.listing_value = value;
      } else if (values[colMap['listing_value']].trim()) {
        errors.push({ row: rowNum, message: `Invalid listing_value: ${values[colMap['listing_value']]}` });
        continue;
      }
    }

    if (colMap['sku'] !== undefined && values[colMap['sku']]) {
      item.sku = values[colMap['sku']].trim();
    }

    if (colMap['linked_lot'] !== undefined && values[colMap['linked_lot']]) {
      item.linked_lot = values[colMap['linked_lot']].trim();
    }

    if (colMap['amazon_asin'] !== undefined && values[colMap['amazon_asin']]) {
      item.amazon_asin = values[colMap['amazon_asin']].trim();
    }

    if (colMap['notes'] !== undefined && values[colMap['notes']]) {
      item.notes = values[colMap['notes']].trim();
    }

    items.push(item);
  }

  return { items, errors };
}

/**
 * Parse a single CSV line, handling quoted values
 */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}
