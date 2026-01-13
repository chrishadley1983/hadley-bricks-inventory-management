import { z } from 'zod';
import { SELLING_PLATFORMS } from '@hadley-bricks/database';

/**
 * Status options for inventory items
 */
export const INVENTORY_STATUS_OPTIONS = [
  'NOT YET RECEIVED',
  'BACKLOG',
  'LISTED',
  'SOLD',
] as const;

export type InventoryStatus = (typeof INVENTORY_STATUS_OPTIONS)[number];

/**
 * Condition options for inventory items
 */
export const INVENTORY_CONDITION_OPTIONS = ['New', 'Used'] as const;

export type InventoryCondition = (typeof INVENTORY_CONDITION_OPTIONS)[number];

/**
 * Shared validation schema for inventory items.
 * Used across form validation, CSV import, AI parsing, and bulk entry.
 */
export const inventoryItemSchema = z.object({
  set_number: z.string().min(1, 'Set number is required'),
  item_name: z.string().optional(),
  condition: z.enum(INVENTORY_CONDITION_OPTIONS).optional(),
  status: z.enum(INVENTORY_STATUS_OPTIONS).optional(),
  source: z.string().optional(),
  purchase_date: z.string().optional(),
  cost: z.number().positive('Cost must be positive').optional(),
  purchase_id: z.string().uuid('Invalid purchase ID').optional(),
  listing_date: z.string().optional(),
  listing_value: z.number().positive('Listing value must be positive').optional(),
  storage_location: z.string().optional(),
  sku: z.string().optional(),
  linked_lot: z.string().optional(),
  amazon_asin: z.string().optional(),
  listing_platform: z.enum(SELLING_PLATFORMS).optional().nullable(),
  notes: z.string().optional(),
});

export type InventoryItemInput = z.infer<typeof inventoryItemSchema>;

/**
 * Schema for form values (accepts strings for numeric fields)
 */
export const inventoryFormSchema = z.object({
  set_number: z.string().min(1, 'Set number is required'),
  item_name: z.string().optional(),
  condition: z.enum(INVENTORY_CONDITION_OPTIONS).optional(),
  status: z.enum(INVENTORY_STATUS_OPTIONS).optional(),
  source: z.string().optional(),
  purchase_date: z.string().optional(),
  cost: z.string().optional(), // String in form, parsed to number on submit
  purchase_id: z.string().optional(), // UUID from purchase lookup
  listing_date: z.string().optional(),
  listing_value: z.string().optional(), // String in form, parsed to number on submit
  storage_location: z.string().optional(),
  sku: z.string().optional(),
  linked_lot: z.string().optional(),
  amazon_asin: z.string().optional(),
  listing_platform: z.string().optional(),
  notes: z.string().optional(),
});

export type InventoryFormValues = z.infer<typeof inventoryFormSchema>;

/**
 * Schema for CSV import - handles string inputs for all fields
 */
export const inventoryCsvRowSchema = z.object({
  set_number: z.string().min(1, 'Set number is required'),
  item_name: z.string().optional(),
  condition: z.string().optional().transform((val) => {
    if (!val) return undefined;
    const normalized = val.trim().toLowerCase();
    if (normalized === 'new' || normalized === 'n') return 'New';
    if (normalized === 'used' || normalized === 'u') return 'Used';
    return undefined;
  }),
  status: z.string().optional().transform((val) => {
    if (!val) return undefined;
    const normalized = val.trim().toUpperCase().replace(/\s+/g, ' ');
    if (INVENTORY_STATUS_OPTIONS.includes(normalized as InventoryStatus)) {
      return normalized as InventoryStatus;
    }
    return undefined;
  }),
  cost: z.string().optional().transform((val) => {
    if (!val) return undefined;
    const num = parseFloat(val.replace(/[£$,]/g, ''));
    return isNaN(num) ? undefined : num;
  }),
  source: z.string().optional(),
  purchase_date: z.string().optional(),
  purchase_id: z.string().optional(),
  storage_location: z.string().optional(),
  notes: z.string().optional(),
});

export type InventoryCsvRow = z.infer<typeof inventoryCsvRowSchema>;

/**
 * Parse form values to API-ready data
 */
export function parseFormToApiData(values: InventoryFormValues): Partial<InventoryItemInput> {
  const costNum = values.cost ? parseFloat(values.cost) : undefined;
  const listingValueNum = values.listing_value ? parseFloat(values.listing_value) : undefined;

  // Destructure listing_platform to handle separately (form is string, API wants enum)
  const { listing_platform, ...rest } = values;

  // Validate listing_platform is a valid selling platform
  const validPlatform = listing_platform && SELLING_PLATFORMS.includes(listing_platform as typeof SELLING_PLATFORMS[number])
    ? (listing_platform as typeof SELLING_PLATFORMS[number])
    : undefined;

  return {
    ...rest,
    cost: costNum && !isNaN(costNum) ? costNum : undefined,
    listing_value: listingValueNum && !isNaN(listingValueNum) ? listingValueNum : undefined,
    purchase_id: values.purchase_id || undefined,
    listing_platform: validPlatform,
  };
}
