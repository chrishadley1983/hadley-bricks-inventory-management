/**
 * Test fixtures for platform orders data
 */

import type { Platform } from '@hadley-bricks/database';

export interface TestPlatformOrder {
  id: string;
  user_id: string;
  platform: Platform;
  platform_order_id: string;
  order_date: string;
  status: string;
  buyer_name: string;
  buyer_email: string;
  shipping_address: string;
  subtotal: number;
  shipping_cost: number;
  total: number;
  currency: string;
  items: TestOrderItem[];
  created_at: string;
  updated_at: string;
  synced_at: string;
}

export interface TestOrderItem {
  id: string;
  order_id: string;
  set_number: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  condition: 'New' | 'Used';
}

export const testBrickLinkOrders: TestPlatformOrder[] = [
  {
    id: 'order-bl-001',
    user_id: 'test-user-id',
    platform: 'bricklink',
    platform_order_id: 'BL-12345678',
    order_date: '2024-12-15T10:30:00Z',
    status: 'Paid',
    buyer_name: 'John Smith',
    buyer_email: 'john.smith@example.com',
    shipping_address: '123 Main St, London, UK, SW1A 1AA',
    subtotal: 125.0,
    shipping_cost: 5.5,
    total: 130.5,
    currency: 'GBP',
    items: [
      {
        id: 'item-bl-001-1',
        order_id: 'order-bl-001',
        set_number: '75192',
        item_name: 'Millennium Falcon',
        quantity: 1,
        unit_price: 125.0,
        condition: 'New',
      },
    ],
    created_at: '2024-12-15T10:30:00Z',
    updated_at: '2024-12-15T10:30:00Z',
    synced_at: '2024-12-15T10:35:00Z',
  },
  {
    id: 'order-bl-002',
    user_id: 'test-user-id',
    platform: 'bricklink',
    platform_order_id: 'BL-12345679',
    order_date: '2024-12-16T14:20:00Z',
    status: 'Shipped',
    buyer_name: 'Jane Doe',
    buyer_email: 'jane.doe@example.com',
    shipping_address: '456 Oak Ave, Manchester, UK, M1 1AA',
    subtotal: 85.0,
    shipping_cost: 4.0,
    total: 89.0,
    currency: 'GBP',
    items: [
      {
        id: 'item-bl-002-1',
        order_id: 'order-bl-002',
        set_number: '76139',
        item_name: '1989 Batmobile',
        quantity: 1,
        unit_price: 85.0,
        condition: 'Used',
      },
    ],
    created_at: '2024-12-16T14:20:00Z',
    updated_at: '2024-12-17T09:00:00Z',
    synced_at: '2024-12-17T09:05:00Z',
  },
];

export const testBrickOwlOrders: TestPlatformOrder[] = [
  {
    id: 'order-bo-001',
    user_id: 'test-user-id',
    platform: 'brickowl',
    platform_order_id: 'BO-98765432',
    order_date: '2024-12-14T09:15:00Z',
    status: 'Processing',
    buyer_name: 'Mike Wilson',
    buyer_email: 'mike.wilson@example.com',
    shipping_address: '789 Pine Rd, Birmingham, UK, B1 1AA',
    subtotal: 200.0,
    shipping_cost: 8.0,
    total: 208.0,
    currency: 'GBP',
    items: [
      {
        id: 'item-bo-001-1',
        order_id: 'order-bo-001',
        set_number: '10276',
        item_name: 'Colosseum',
        quantity: 1,
        unit_price: 200.0,
        condition: 'New',
      },
    ],
    created_at: '2024-12-14T09:15:00Z',
    updated_at: '2024-12-14T09:15:00Z',
    synced_at: '2024-12-14T09:20:00Z',
  },
];

export const testBricqerOrders: TestPlatformOrder[] = [
  {
    id: 'order-bq-001',
    user_id: 'test-user-id',
    platform: 'bricqer',
    platform_order_id: 'BQ-55667788',
    order_date: '2024-12-13T16:45:00Z',
    status: 'Completed',
    buyer_name: 'Sarah Brown',
    buyer_email: 'sarah.brown@example.com',
    shipping_address: '321 Elm St, Leeds, UK, LS1 1AA',
    subtotal: 350.0,
    shipping_cost: 0.0, // Free shipping
    total: 350.0,
    currency: 'GBP',
    items: [
      {
        id: 'item-bq-001-1',
        order_id: 'order-bq-001',
        set_number: '42143',
        item_name: 'Ferrari Daytona SP3',
        quantity: 1,
        unit_price: 350.0,
        condition: 'New',
      },
    ],
    created_at: '2024-12-13T16:45:00Z',
    updated_at: '2024-12-18T10:00:00Z',
    synced_at: '2024-12-18T10:05:00Z',
  },
];

export const allTestOrders = [
  ...testBrickLinkOrders,
  ...testBrickOwlOrders,
  ...testBricqerOrders,
];

/**
 * Helper to get orders by platform
 */
export function getTestOrdersByPlatform(platform: Platform): TestPlatformOrder[] {
  switch (platform) {
    case 'bricklink':
      return testBrickLinkOrders;
    case 'brickowl':
      return testBrickOwlOrders;
    case 'bricqer':
      return testBricqerOrders;
    default:
      return [];
  }
}

/**
 * Helper to get orders by status
 */
export function getTestOrdersByStatus(status: string): TestPlatformOrder[] {
  return allTestOrders.filter((order) => order.status === status);
}
