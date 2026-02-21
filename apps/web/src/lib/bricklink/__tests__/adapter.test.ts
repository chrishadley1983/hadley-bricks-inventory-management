import { describe, it, expect } from 'vitest';
import { normalizeOrder, normalizeOrders, calculateOrderStats } from '../adapter';
import type { BrickLinkOrderDetail, BrickLinkOrderItem, NormalizedOrder } from '../types';

describe('BrickLink Adapter', () => {
  // Helper to create mock BrickLink order
  const createMockOrder = (
    overrides: Partial<BrickLinkOrderDetail> = {}
  ): BrickLinkOrderDetail => ({
    order_id: 12345678,
    date_ordered: '2024-01-15T10:30:00.000Z',
    seller_name: 'TestSeller',
    store_name: 'Test Store',
    buyer_name: 'John Smith',
    buyer_email: 'john.smith@example.com',
    status: 'SHIPPED',
    total_count: 5,
    unique_count: 3,
    cost: {
      currency_code: 'GBP',
      subtotal: '45.00',
      grand_total: '52.95',
      shipping: '4.95',
      salesTax_collected_by_bl: '3.00',
    },
    shipping: {
      tracking_no: 'TRACK123',
      address: {
        name: { full: 'John Smith' },
        full: 'John Smith\n123 Test Street\nLondon\nSW1A 1AA\nUK',
        address1: '123 Test Street',
        city: 'London',
        postal_code: 'SW1A 1AA',
        country_code: 'UK',
      },
    },
    ...overrides,
  });

  // Helper to create mock BrickLink order item
  const createMockItem = (overrides: Partial<BrickLinkOrderItem> = {}): BrickLinkOrderItem => ({
    inventory_id: 123456,
    item: {
      no: '3001',
      name: 'Brick 2 x 4',
      type: 'PART',
      category_id: 5,
    },
    color_id: 11,
    color_name: 'Black',
    quantity: 10,
    new_or_used: 'N',
    unit_price: '0.05',
    currency_code: 'GBP',
    ...overrides,
  });

  describe('normalizeOrder', () => {
    describe('basic order normalization', () => {
      it('should normalize a basic order with all fields', () => {
        const order = createMockOrder();
        const items = [createMockItem()];

        const result = normalizeOrder(order, items);

        expect(result.platformOrderId).toBe('12345678');
        expect(result.platform).toBe('bricklink');
        expect(result.orderDate).toEqual(new Date('2024-01-15T10:30:00.000Z'));
        expect(result.status).toBe('Shipped');
        expect(result.buyerName).toBe('John Smith');
        expect(result.buyerEmail).toBe('john.smith@example.com');
        expect(result.currency).toBe('GBP');
      });

      it('should calculate financial values correctly', () => {
        const order = createMockOrder({
          cost: {
            currency_code: 'GBP',
            subtotal: '100.00',
            shipping: '10.00',
            salesTax_collected_by_bl: '5.00',
            grand_total: '115.00',
          },
        });

        const result = normalizeOrder(order);

        expect(result.subtotal).toBe(100);
        expect(result.shipping).toBe(10);
        expect(result.fees).toBe(5);
        expect(result.total).toBe(115);
      });

      it('should use final_total when grand_total is missing', () => {
        const order = createMockOrder({
          cost: {
            currency_code: 'GBP',
            subtotal: '50.00',
            shipping: '5.00',
            grand_total: '',
            final_total: '55.00',
          },
        });

        const result = normalizeOrder(order);

        expect(result.total).toBe(55);
      });

      it('should include raw order data', () => {
        const order = createMockOrder();

        const result = normalizeOrder(order);

        expect(result.rawData).toEqual(order);
      });
    });

    describe('status normalization', () => {
      it.each([
        ['PENDING', 'Pending'],
        ['UPDATED', 'Updated'],
        ['PROCESSING', 'Processing'],
        ['READY', 'Ready'],
        ['PAID', 'Paid'],
        ['PACKED', 'Packed'],
        ['SHIPPED', 'Shipped'],
        ['RECEIVED', 'Received'],
        ['COMPLETED', 'Completed'],
        ['OCR', 'Order Cancelled (Refund)'],
        ['NPB', 'Non-Paying Buyer'],
        ['NPX', 'Non-Paying Buyer (Expired)'],
        ['NRS', 'Non-Responding Seller'],
        ['NSS', 'Non-Shipping Seller'],
        ['CANCELLED', 'Cancelled'],
      ])('should normalize status %s to %s', (brickLinkStatus, expectedStatus) => {
        const order = createMockOrder({
          status: brickLinkStatus as BrickLinkOrderDetail['status'],
        });

        const result = normalizeOrder(order);

        expect(result.status).toBe(expectedStatus);
      });

      it('should pass through unknown statuses as-is', () => {
        const order = createMockOrder({
          status: 'UNKNOWN_STATUS' as BrickLinkOrderDetail['status'],
        });

        const result = normalizeOrder(order);

        expect(result.status).toBe('UNKNOWN_STATUS');
      });
    });

    describe('shipping address normalization', () => {
      it('should normalize complete shipping address', () => {
        const order = createMockOrder({
          shipping: {
            tracking_no: 'ABC123',
            address: {
              name: { full: 'Jane Doe', first: 'Jane', last: 'Doe' },
              full: 'Jane Doe\n456 Main St\nManchester\nM1 1AA\nUK',
              address1: '456 Main St',
              address2: 'Flat 2',
              city: 'Manchester',
              state: 'Greater Manchester',
              postal_code: 'M1 1AA',
              country_code: 'UK',
            },
          },
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

      it('should use full address line as name fallback', () => {
        const order = createMockOrder({
          shipping: {
            address: {
              full: 'Company Name\n123 Business Ave\nBirmingham',
              address1: '123 Business Ave',
              city: 'Birmingham',
              country_code: 'UK',
            },
          },
        });

        const result = normalizeOrder(order);

        expect(result.shippingAddress?.name).toBe('Company Name');
      });

      it('should handle missing shipping address', () => {
        const order = createMockOrder({ shipping: undefined });

        const result = normalizeOrder(order);

        expect(result.shippingAddress).toBeUndefined();
      });

      it('should handle missing address within shipping', () => {
        const order = createMockOrder({
          shipping: { tracking_no: 'ABC123' },
        });

        const result = normalizeOrder(order);

        expect(result.shippingAddress).toBeUndefined();
      });

      it('should include tracking number', () => {
        const order = createMockOrder({
          shipping: { tracking_no: 'ROYAL123' },
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
            item: { no: '3001', name: 'Brick 2 x 4', type: 'PART', category_id: 5 },
            color_id: 11,
            color_name: 'Black',
            quantity: 10,
            new_or_used: 'N',
            unit_price: '0.05',
            currency_code: 'GBP',
          }),
        ];

        const result = normalizeOrder(order, items);

        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toEqual({
          itemNumber: '3001',
          itemName: 'Brick 2 x 4',
          itemType: 'PART',
          colorId: 11,
          colorName: 'Black',
          quantity: 10,
          condition: 'New',
          unitPrice: 0.05,
          totalPrice: 0.5,
          currency: 'GBP',
        });
      });

      it('should normalize used item condition', () => {
        const order = createMockOrder();
        const items = [createMockItem({ new_or_used: 'U' })];

        const result = normalizeOrder(order, items);

        expect(result.items[0].condition).toBe('Used');
      });

      it('should use unit_price_final when available', () => {
        const order = createMockOrder();
        const items = [
          createMockItem({
            unit_price: '1.00',
            unit_price_final: '0.90', // Discounted
            quantity: 5,
          }),
        ];

        const result = normalizeOrder(order, items);

        expect(result.items[0].unitPrice).toBe(0.9);
        expect(result.items[0].totalPrice).toBe(4.5);
      });

      it('should handle multiple items', () => {
        const order = createMockOrder();
        const items = [
          createMockItem({ item: { no: '3001', name: 'Part 1', type: 'PART', category_id: 1 } }),
          createMockItem({
            item: { no: 'sw0001', name: 'Minifig 1', type: 'MINIFIG', category_id: 2 },
          }),
          createMockItem({ item: { no: '75192-1', name: 'Set 1', type: 'SET', category_id: 3 } }),
        ];

        const result = normalizeOrder(order, items);

        expect(result.items).toHaveLength(3);
        expect(result.items.map((i) => i.itemType)).toEqual(['PART', 'MINIFIG', 'SET']);
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
    });

    describe('currency parsing', () => {
      it('should parse currency strings correctly', () => {
        const order = createMockOrder({
          cost: {
            currency_code: 'GBP',
            subtotal: '£100.50',
            shipping: '£5.99',
            grand_total: '£106.49',
          },
        });

        const result = normalizeOrder(order);

        expect(result.subtotal).toBe(100.5);
        expect(result.shipping).toBe(5.99);
        expect(result.total).toBe(106.49);
      });

      it('should handle empty/null currency values', () => {
        const order = createMockOrder({
          cost: {
            currency_code: 'GBP',
            subtotal: '',
            shipping: undefined as unknown as string,
            grand_total: '50.00',
          },
        });

        const result = normalizeOrder(order);

        expect(result.subtotal).toBe(0);
        expect(result.shipping).toBe(0);
        expect(result.total).toBe(50);
      });

      it('should handle negative values', () => {
        const order = createMockOrder({
          cost: {
            currency_code: 'GBP',
            subtotal: '-10.00',
            shipping: '0.00',
            grand_total: '-10.00',
          },
        });

        const result = normalizeOrder(order);

        expect(result.subtotal).toBe(-10);
      });

      it('should handle various currency formats', () => {
        const order = createMockOrder({
          cost: {
            currency_code: 'EUR',
            subtotal: '1.234,56',
            shipping: '10',
            grand_total: '1.244,56',
          },
        });

        const result = normalizeOrder(order);

        // Note: Current implementation removes all non-numeric chars except . and -
        // This test documents current behavior - commas are removed, dots preserved
        expect(result.subtotal).toBe(1.23456);
      });
    });
  });

  describe('normalizeOrders', () => {
    it('should normalize multiple orders', () => {
      const ordersWithItems = [
        {
          order: createMockOrder({ order_id: 1 }),
          items: [createMockItem()],
        },
        {
          order: createMockOrder({ order_id: 2 }),
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
        { order: createMockOrder({ order_id: 1 }) },
        { order: createMockOrder({ order_id: 2 }), items: undefined },
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
    const createNormalizedOrder = (overrides: Partial<NormalizedOrder> = {}): NormalizedOrder => ({
      platformOrderId: '1',
      platform: 'bricklink',
      orderDate: new Date(),
      status: 'Completed',
      buyerName: 'Test',
      subtotal: 100,
      shipping: 10,
      fees: 5,
      total: 115,
      currency: 'GBP',
      items: [
        {
          itemNumber: '3001',
          itemName: 'Test',
          itemType: 'PART',
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
            {
              itemNumber: '1',
              itemName: 'A',
              itemType: 'PART',
              quantity: 5,
              condition: 'New',
              unitPrice: 1,
              totalPrice: 5,
              currency: 'GBP',
            },
            {
              itemNumber: '2',
              itemName: 'B',
              itemType: 'PART',
              quantity: 3,
              condition: 'New',
              unitPrice: 1,
              totalPrice: 3,
              currency: 'GBP',
            },
          ],
        }),
        createNormalizedOrder({
          items: [
            {
              itemNumber: '3',
              itemName: 'C',
              itemType: 'SET',
              quantity: 1,
              condition: 'New',
              unitPrice: 10,
              totalPrice: 10,
              currency: 'GBP',
            },
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
        createNormalizedOrder({ status: 'Completed' }),
        createNormalizedOrder({ status: 'Pending' }),
        createNormalizedOrder({ status: 'Completed' }),
      ];

      const stats = calculateOrderStats(orders);

      expect(stats.byStatus).toEqual({
        Shipped: 2,
        Completed: 2,
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
  });
});
