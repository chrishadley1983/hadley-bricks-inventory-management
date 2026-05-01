import { z } from 'zod';

export const ORDER_ISSUE_PLATFORMS = ['bricklink', 'brickowl'] as const;
export type OrderIssuePlatform = (typeof ORDER_ISSUE_PLATFORMS)[number];

export const ORDER_ISSUE_DISCOVERED_BY = ['us', 'buyer'] as const;
export type OrderIssueDiscoveredBy = (typeof ORDER_ISSUE_DISCOVERED_BY)[number];

export const ORDER_ISSUE_STATUSES = [
  'open',
  'awaiting_buyer',
  'awaiting_us',
  'resolved_refund',
  'resolved_replacement',
  'resolved_partial',
  'resolved_credit',
  'closed_no_action',
] as const;
export type OrderIssueStatus = (typeof ORDER_ISSUE_STATUSES)[number];

export const ORDER_ISSUE_OPEN_STATUSES = ['open', 'awaiting_buyer', 'awaiting_us'] as const;

export const ORDER_ISSUE_ITEM_TYPES = [
  'missing_from_inventory',
  'damaged_in_inventory',
  'missing_from_shipment',
  'damaged_in_transit',
  'wrong_item_sent',
  'wrong_qty_sent',
  'shipment_lost',
  'other',
] as const;
export type OrderIssueItemType = (typeof ORDER_ISSUE_ITEM_TYPES)[number];

export const ORDER_ISSUE_MESSAGE_SOURCES = [
  'gmail',
  'bricklink',
  'brickowl',
  'bricqer',
  'manual',
] as const;
export type OrderIssueMessageSource = (typeof ORDER_ISSUE_MESSAGE_SOURCES)[number];

export const ORDER_ISSUE_MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export type OrderIssueMessageDirection = (typeof ORDER_ISSUE_MESSAGE_DIRECTIONS)[number];

export const ORDER_ITEM_CONDITIONS = ['New', 'Used'] as const;

export const createOrderIssueSchema = z.object({
  platform: z.enum(ORDER_ISSUE_PLATFORMS),
  platform_order_id: z.string().min(1, 'Order number is required'),
  discovered_by: z.enum(ORDER_ISSUE_DISCOVERED_BY),
  issue_status: z.enum(ORDER_ISSUE_STATUSES).optional(),
  planned_resolution: z.string().optional(),
  items: z
    .array(
      z.object({
        order_item_id: z.string().uuid().optional().nullable(),
        item_number: z.string().min(1),
        item_name: z.string().optional().nullable(),
        item_type: z.string().optional().nullable(),
        color_id: z.number().int().optional().nullable(),
        color_name: z.string().optional().nullable(),
        condition: z.enum(ORDER_ITEM_CONDITIONS).optional().nullable(),
        qty_expected: z.number().int().nonnegative(),
        qty_received: z.number().int().nonnegative().default(0),
        issue_type: z.enum(ORDER_ISSUE_ITEM_TYPES),
        notes: z.string().optional().nullable(),
      }),
    )
    .min(0)
    .default([]),
});

export type CreateOrderIssueInput = z.infer<typeof createOrderIssueSchema>;

export const updateOrderIssueSchema = z
  .object({
    issue_status: z.enum(ORDER_ISSUE_STATUSES).optional(),
    planned_resolution: z.string().nullable().optional(),
    refund_amount: z.number().nullable().optional(),
    replacement_qty: z.number().int().nullable().optional(),
    credit_amount: z.number().nullable().optional(),
    discovered_by: z.enum(ORDER_ISSUE_DISCOVERED_BY).optional(),
  })
  .strict();

export type UpdateOrderIssueInput = z.infer<typeof updateOrderIssueSchema>;

export const addOrderIssueItemSchema = z.object({
  order_item_id: z.string().uuid().optional().nullable(),
  item_number: z.string().min(1),
  item_name: z.string().optional().nullable(),
  item_type: z.string().optional().nullable(),
  color_id: z.number().int().optional().nullable(),
  color_name: z.string().optional().nullable(),
  condition: z.enum(ORDER_ITEM_CONDITIONS).optional().nullable(),
  qty_expected: z.number().int().nonnegative(),
  qty_received: z.number().int().nonnegative().default(0),
  issue_type: z.enum(ORDER_ISSUE_ITEM_TYPES),
  notes: z.string().optional().nullable(),
});

export type AddOrderIssueItemInput = z.infer<typeof addOrderIssueItemSchema>;

export const updateOrderIssueItemSchema = z
  .object({
    qty_received: z.number().int().nonnegative().optional(),
    issue_type: z.enum(ORDER_ISSUE_ITEM_TYPES).optional(),
    notes: z.string().nullable().optional(),
    resolved: z.boolean().optional(),
  })
  .strict();

export type UpdateOrderIssueItemInput = z.infer<typeof updateOrderIssueItemSchema>;

export const createOrderIssueMessageSchema = z.object({
  source: z.enum(ORDER_ISSUE_MESSAGE_SOURCES),
  external_message_id: z.string().nullable().optional(),
  direction: z.enum(ORDER_ISSUE_MESSAGE_DIRECTIONS),
  sent_at: z.string().datetime(),
  from_address: z.string().nullable().optional(),
  to_address: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  body_html: z.string().nullable().optional(),
  attachments: z.unknown().nullable().optional(),
  content_fingerprint: z.string().nullable().optional(),
});

export type CreateOrderIssueMessageInput = z.infer<typeof createOrderIssueMessageSchema>;
