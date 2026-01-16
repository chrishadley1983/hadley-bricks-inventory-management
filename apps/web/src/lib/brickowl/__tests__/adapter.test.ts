import { describe, it, expect } from 'vitest';
import { normalizeOrder, normalizeOrders, calculateOrderStats } from '../adapter';
import type {
  BrickOwlOrderDetail,
  BrickOwlOrderItem,
  NormalizedBrickOwlOrder,
} from '../types';

describe('Brick Owl Adapter', () => {
  // Helper to create mock Brick Owl order
  const createMockOrder = (
    overrides: Partial<BrickOwlOrderDetail> = {}
  ): BrickOwlOrderDetail => ({
    order_id: '12345678',
    status: 'Shipped',
    order_time: '2024-01-15 10:30:00',
    iso_order_time: '2024-01-15T10:30:00.000Z',
    buyer_name: 'John Smith',
    buyer_email: 'john.smith@example.com',
    ship_country_code: 'UK',
    ship_first_name: 'John',
    ship_last_name: 'Smith',
    ship_street_1: '123 Test Street',
    ship_city: 'London',
    ship_post_code: 'SW1A 1AA',
    base_order_total: '45.00',
    order_total: '52.95',
    sub_total: '45.00',
    total_shipping: '4.95',
    total_tax: '3.00',
    currency: 'GBP',
    tracking_number: 'TRACK123',
    ...overrides,
  });

  // Helper to create mock Brick Owl order item
  const createMockItem = (
    overrides: Partial<BrickOwlOrderItem> = {}
  ): BrickOwlOrderItem => ({
    order_item_id: '123456',
    boid: '3001-11',
    name: 'Brick 2 x 4',
    type: 'Part',
    color_id: '11',
    color_name: 'Black',
    condition: 'new',
    ordered_quantity: 10,
    base_price: '0.05',
    unit_price: '0.05',
    total_price: '0.50',
    ...overrides,
  });

  describe('normalizeOrder', () => {
    describe('basic order normalization', () => {
      it('should normalize a basic order with all fields', () => {
        const order = createMockOrder();
        const items = [createMockItem()];

        const result = normalizeOrder(order, items);

        expect(result.platformOrderId).toBe('12345678');
        expect(result.platform).toBe('brickowl');
        expect(result.orderDate).toEqual(new Date('2024-01-15T10:30:00.000Z'));
        expect(result.status).toBe('Shipped');
        expect(result.buyerName).toBe('John Smith');
        expect(result.buyerEmail).toBe('john.smith@example.com');
        expect(result.currency).toBe('GBP');
      });

      it('should calculate financial values correctly', () => {
        const order = createMockOrder({
          sub_total: '100.00',
          total_shipping: '10.00',
          total_tax: '5.00',
          order_total: '115.00',
        });

        const result = normalizeOrder(order);

        expect(result.subtotal).toBe(100);
        expect(result.shipping).toBe(10);
        expect(result.fees).toBe(5);
        expect(result.total).toBe(115);
      });

      it('should use base_order_total when sub_total is missing', () => {
        const order = createMockOrder({
          sub_total: undefined,
          base_order_total: '50.00',
          total_shipping: '5.00',
          order_total: '55.00',
        });

        const result = normalizeOrder(order);

        expect(result.subtotal).toBe(50);
      });

      it('should include raw order data', () => {
        const order = createMockOrder();

        const result = normalizeOrder(order);

        expect(result.rawData).toEqual(order);
      });

      it('should default currency to GBP when not specified', () => {
        const order = createMockOrder({ currency: undefined });

        const result = normalizeOrder(order);

        expect(result.currency).toBe('GBP');
      });
    });

    describe('status normalization', () => {
      it.each([
        ['Pending', 'Pending'],
        ['Payment Received', 'Paid'],
        ['Payment Submitted', 'Payment Submitted'],
        ['Processing', 'Processing'],
        ['Processed', 'Processed'],
        ['Shipped', 'Shipped'],
        ['Received', 'Received'],
        ['Cancelled', 'Cancelled'],
        ['On Hold', 'On Hold'],
      ])(
        'should normalize status %s to %s',
        (brickOwlStatus, expectedStatus) => {
          const order = createMockOrder({
            status: brickOwlStatus as BrickOwlOrderDetail['status'],
          });

          const result = normalizeOrder(order);

          expect(result.status).toBe(expectedStatus);
        }
      );

      it('should pass through unknown statuses as-is', () => {
        const order = createMockOrder({
          status: 'UnknownStatus' as BrickOwlOrderDetail['status'],
        });

        const result = normalizeOrder(order);

        expect(result.status).toBe('UnknownStatus');
      });
    });

    describe('shipping address normalization', () => {
      it('should normalize complete shipping address', () => {
        const order = createMockOrder({
          ship_first_name: 'Jane',
          ship_last_name: 'Doe',
          ship_street_1: '456 Main St',
          ship_street_2: 'Flat 2',
          ship_city: 'Manchester',
          ship_region: 'Greater Manchester',
          ship_post_code: 'M1 1AA',
          ship_country_code: 'UK',
        });

        const result = normalizeOrder(order);

        expect(result.shippingAddress).toEqual({
          name: 'Jane Doe',
          address1: '456 Main St',
          address2: 'Flat 2',
          city: 'Manchester',
          state: 'Greater Manchester',
          postalCode: 'M1 1AA',
          countryCode: 'UK',
        });
      });

      it('should use buyer_name when shipping name fields are empty', () => {
        const order = createMockOrder({
          buyer_name: 'Company Name',
          ship_first_name: '',
          ship_last_name: '',
          ship_country_code: 'UK',
        });

        const result = normalizeOrder(order);

        expect(result.shippingAddress?.name).toBe('Company Name');
      });

      it('should handle missing shipping address', () => {
        const order = createMockOrder({
          ship_country_code: undefined as unknown as string,
        });

        const result = normalizeOrder(order);

        expect(result.shippingAddress).toBeUndefined();
      });

      it('should include tracking number', () => {
        const order = createMockOrder({
          tracking_number: 'ROYAL123',
        });

        const result = normalizeOrder(order);

        expect(result.trackingNumber).toBe('ROYAL123');
      });
    });

    describe('order items normalization', () => {
      it('should normalize order items correctly', () => {
        const order = createMockOrder();
        const items = [
          createMockItem({
            boid: '3001-11',
            name: 'Brick 2 x 4',
            type: 'Part',
            color_id: '11',
            color_name: 'Black',
            condition: 'new',
            ordered_quantity: 10,
            unit_price: '0.05',
            total_price: '0.50',
          }),
        ];

        const result = normalizeOrder(order, items);

        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toEqual({
          itemNumber: '3001-11',
          itemName: 'Brick 2 x 4',
          itemType: 'Part',
          colorId: 11,
          colorName: 'Black',
          quantity: 10,
          condition: 'New',
          unitPrice: 0.05,
          totalPrice: 0.5,
          currency: 'GBP',
        });
      });

      it('should normalize used item conditions', () => {
        const order = createMockOrder();

        const conditions: Array<{ input: BrickOwlOrderItem['condition']; expected: 'New' | 'Used' }> = [
          { input: 'new', expected: 'New' },
          { input: 'usedn', expected: 'Used' },
          { input: 'usedg', expected: 'Used' },
          { input: 'useda', expected: 'Used' },
        ];

        for (const { input, expected } of conditions) {
          const items = [createMockItem({ condition: input })];
          const result = normalizeOrder(order, items);
          expect(result.items[0].condition).toBe(expected);
        }
      });

      it('should use base_price when unit_price is missing', () => {
        const order = createMockOrder();
        const items = [
          createMockItem({
            unit_price: undefined,
            base_price: '1.00',
            ordered_quantity: 5,
          }),
        ];

        const result = normalizeOrder(order, items);

        expect(result.items[0].unitPrice).toBe(1);
      });

      it('should calculate totalPrice when not provided', () => {
        const order = createMockOrder();
        const items = [
          createMockItem({
            unit_price: '2.00',
            total_price: undefined,
            ordered_quantity: 3,
          }),
        ];

        const result = normalizeOrder(order, items);

        expect(result.items[0].totalPrice).toBe(6); // 2.00 * 3
      });

      it('should handle multiple items', () => {
        const order = createMockOrder();
        const items = [
          createMockItem({ boid: '3001-11', name: 'Part 1', type: 'Part' }),
          createMockItem({ boid: 'sw0001', name: 'Minifig 1', type: 'Minifigure' }),
          createMockItem({ boid: '75192-1', name: 'Set 1', type: 'Set' }),
        ];

        const result = normalizeOrder(order, items);

        expect(result.items).toHaveLength(3);
        expect(result.items.map((i) => i.itemType)).toEqual(['Part', 'Minifigure', 'Set']);
      });

      it('should handle empty items array', () => {
        const order = createMockOrder();

        const result = normalizeOrder(order, []);

        expect(result.items).toHaveLength(0);
      });

      it('should default items to empty array when not provided', () => {
        const order = createMockOrder();

        const result = normalizeOrder(order);

        expect(result.items).toHaveLength(0);
      });

      it('should handle items without color', () => {
        const order = createMockOrder();
        const items = [
          createMockItem({
            color_id: undefined,
            color_name: undefined,
          }),
        ];

        const result = normalizeOrder(order, items);

        expect(result.items[0].colorId).toBeUndefined();
        expect(result.items[0].colorName).toBeUndefined();
      });
    });

    describe('currency parsing', () => {
      it('should parse currency strings correctly', () => {
        const order = createMockOrder({
          sub_total: '£100.50',
          total_shipping: '£5.99',
          order_total: '£106.49',
        });

        const result = normalizeOrder(order);

        expect(result.subtotal).toBe(100.5);
        expect(result.shipping).toBe(5.99);
        expect(result.total).toBe(106.49);
      });

      it('should handle empty/null currency values', () => {
        const order = createMockOrder({
          sub_total: '',
          base_order_total: '', // Also clear fallback
          total_shipping: undefined as unknown as string,
          order_total: '50.00',
        });

        const result = normalizeOrder(order);

        expect(result.subtotal).toBe(0);
        expect(result.shipping).toBe(0);
        expect(result.total).toBe(50);
      });

      it('should handle negative values', () => {
        const order = createMockOrder({
          sub_total: '-10.00',
          total_shipping: '0.00',
          order_total: '-10.00',
        });

        const result = normalizeOrder(order);

        expect(result.subtotal).toBe(-10);
      });
    });

    describe('date parsing', () => {
      it('should prefer iso_order_time over order_time', () => {
        const order = createMockOrder({
          order_time: '2024-01-14 09:00:00',
          iso_order_time: '2024-01-15T10:30:00.000Z',
        });

        const result = normalizeOrder(order);

        expect(result.orderDate).toEqual(new Date('2024-01-15T10:30:00.000Z'));
      });

      it('should fall back to order_time when iso_order_time is missing', () => {
        const order = createMockOrder({
          order_time: '2024-01-14 09:00:00',
          iso_order_time: undefined as unknown as string,
        });

        const result = normalizeOrder(order);

        expect(result.orderDate).toBeInstanceOf(Date);
      });
    });

    describe('fee handling', () => {
      it('should use sales_tax_collected_by_bo when available', () => {
        const order = createMockOrder({
          sales_tax_collected_by_bo: '8.50',
          total_tax: '5.00',
        });

        const result = normalizeOrder(order);

        expect(result.fees).toBe(8.5);
      });

      it('should fall back to total_tax when sales_tax_collected_by_bo is missing', () => {
        const order = createMockOrder({
          sales_tax_collected_by_bo: undefined,
          total_tax: '5.00',
        });

        const result = normalizeOrder(order);

        expect(result.fees).toBe(5);
      });
    });
  });

  describe('normalizeOrders', () => {
    it('should normalize multiple orders', () => {
      const ordersWithItems = [
        {
          order: createMockOrder({ order_id: '1' }),
          items: [createMockItem()],
        },
        {
          order: createMockOrder({ order_id: '2' }),
          items: [createMockItem(), createMockItem()],
        },
      ];

      const result = normalizeOrders(ordersWithItems);

      expect(result).toHaveLength(2);
      expect(result[0].platformOrderId).toBe('1');
      expect(result[0].items).toHaveLength(1);
      expect(result[1].platformOrderId).toBe('2');
      expect(result[1].items).toHaveLength(2);
    });

    it('should handle orders without items', () => {
      const ordersWithItems = [
        { order: createMockOrder({ order_id: '1' }) },
        { order: createMockOrder({ order_id: '2' }), items: undefined },
      ];

      const result = normalizeOrders(ordersWithItems);

      expect(result[0].items).toHaveLength(0);
      expect(result[1].items).toHaveLength(0);
    });

    it('should handle empty orders array', () => {
      const result = normalizeOrders([]);

      expect(result).toHaveLength(0);
    });
  });

  describe('calculateOrderStats', () => {
    const createNormalizedOrder = (
      overrides: Partial<NormalizedBrickOwlOrder> = {}
    ): NormalizedBrickOwlOrder => ({
      platformOrderId: '1',
      platform: 'brickowl',
      orderDate: new Date(),
      status: 'Shipped',
      buyerName: 'Test',
      subtotal: 100,
      shipping: 10,
      fees: 5,
      total: 115,
      currency: 'GBP',
      items: [
        {
          itemNumber: '3001-11',
          itemName: 'Test',
          itemType: 'Part',
          quantity: 10,
          condition: 'New',
          unitPrice: 1,
          totalPrice: 10,
          currency: 'GBP',
        },
      ],
      rawData: createMockOrder(),
      ...overrides,
    });

    it('should calculate basic statistics', () => {
      const orders = [
        createNormalizedOrder({ total: 100 }),
        createNormalizedOrder({ total: 200 }),
        createNormalizedOrder({ total: 150 }),
      ];

      const stats = calculateOrderStats(orders);

      expect(stats.totalOrders).toBe(3);
      expect(stats.totalRevenue).toBe(450);
      expect(stats.averageOrderValue).toBe(150);
    });

    it('should count total items across orders', () => {
      const orders = [
        createNormalizedOrder({
          items: [
            { itemNumber: '1', itemName: 'A', itemType: 'Part', quantity: 5, condition: 'New', unitPrice: 1, totalPrice: 5, currency: 'GBP' },
            { itemNumber: '2', itemName: 'B', itemType: 'Part', quantity: 3, condition: 'New', unitPrice: 1, totalPrice: 3, currency: 'GBP' },
          ],
        }),
        createNormalizedOrder({
          items: [
            { itemNumber: '3', itemName: 'C', itemType: 'Set', quantity: 1, condition: 'New', unitPrice: 10, totalPrice: 10, currency: 'GBP' },
          ],
        }),
      ];

      const stats = calculateOrderStats(orders);

      expect(stats.totalItems).toBe(9); // 5 + 3 + 1
    });

    it('should count orders by status', () => {
      const orders = [
        createNormalizedOrder({ status: 'Shipped' }),
        createNormalizedOrder({ status: 'Shipped' }),
        createNormalizedOrder({ status: 'Received' }),
        createNormalizedOrder({ status: 'Pending' }),
        createNormalizedOrder({ status: 'Received' }),
      ];

      const stats = calculateOrderStats(orders);

      expect(stats.byStatus).toEqual({
        Shipped: 2,
        Received: 2,
        Pending: 1,
      });
    });

    it('should handle empty orders array', () => {
      const stats = calculateOrderStats([]);

      expect(stats.totalOrders).toBe(0);
      expect(stats.totalRevenue).toBe(0);
      expect(stats.totalItems).toBe(0);
      expect(stats.averageOrderValue).toBe(0);
      expect(stats.byStatus).toEqual({});
    });

    it('should handle orders with no items', () => {
      const orders = [createNormalizedOrder({ items: [] })];

      const stats = calculateOrderStats(orders);

      expect(stats.totalItems).toBe(0);
    });

    it('should calculate correct average for single order', () => {
      const orders = [createNormalizedOrder({ total: 75.50 })];

      const stats = calculateOrderStats(orders);

      expect(stats.averageOrderValue).toBe(75.50);
    });

    it('should handle decimal totals correctly', () => {
      const orders = [
        createNormalizedOrder({ total: 33.33 }),
        createNormalizedOrder({ total: 33.33 }),
        createNormalizedOrder({ total: 33.34 }),
      ];

      const stats = calculateOrderStats(orders);

      expect(stats.totalRevenue).toBe(100);
      expect(stats.averageOrderValue).toBeCloseTo(33.33, 2);
    });
  });
});
