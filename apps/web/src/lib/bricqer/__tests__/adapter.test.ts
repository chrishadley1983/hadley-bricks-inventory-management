import { describe, it, expect } from 'vitest';
import {
  normalizeOrder,
  normalizeOrders,
  normalizeOrderItem,
  normalizeInventoryItem,
  normalizeInventoryItems,
  calculateOrderStats,
  calculateInventoryStats,
} from '../adapter';
import type {
  BricqerOrder,
  BricqerOrderDetail,
  BricqerOrderItem,
  BricqerInventoryItem,
  NormalizedBricqerOrder,
  NormalizedBricqerInventoryItem,
} from '../types';

describe('Bricqer Adapter', () => {
  describe('normalizeOrderItem', () => {
    it('should normalize a basic order item', () => {
      const item: BricqerOrderItem = {
        id: 123,
        name: 'Test Part',
        sku: '3001',
        quantity: 5,
        price: '1.50',
        total: '7.50',
        condition: 'new',
        item_type: 'Part',
      };

      const result = normalizeOrderItem(item, 'GBP');

      expect(result).toEqual({
        itemNumber: '3001',
        itemName: 'Test Part',
        itemType: 'Part',
        colorId: undefined,
        colorName: undefined,
        quantity: 5,
        condition: 'New',
        unitPrice: 1.5,
        totalPrice: 7.5,
        currency: 'GBP',
      });
    });

    it('should use bricklink_id when sku is not available', () => {
      const item: BricqerOrderItem = {
        id: 123,
        name: 'Test Part',
        bricklink_id: 'BL-3001',
        quantity: 1,
        price: '2.00',
        total: '2.00',
      };

      const result = normalizeOrderItem(item, 'EUR');

      expect(result.itemNumber).toBe('BL-3001');
    });

    it('should use lego_id when sku and bricklink_id are not available', () => {
      const item: BricqerOrderItem = {
        id: 123,
        name: 'Test Part',
        lego_id: 'LEGO-3001',
        quantity: 1,
        price: '2.00',
        total: '2.00',
      };

      const result = normalizeOrderItem(item, 'USD');

      expect(result.itemNumber).toBe('LEGO-3001');
    });

    it('should fallback to id when no identifiers available', () => {
      const item: BricqerOrderItem = {
        id: 456,
        name: 'Test Part',
        quantity: 1,
        price: '2.00',
        total: '2.00',
      };

      const result = normalizeOrderItem(item, 'GBP');

      expect(result.itemNumber).toBe('456');
    });

    it('should calculate total from unit price and quantity when total is missing', () => {
      // Use type assertion since we're testing behavior when total is missing
      const item = {
        id: 123,
        name: 'Test Part',
        sku: '3001',
        quantity: 3,
        price: '2.50',
      } as BricqerOrderItem;

      const result = normalizeOrderItem(item, 'GBP');

      expect(result.totalPrice).toBe(7.5);
    });

    it('should handle used condition', () => {
      const item: BricqerOrderItem = {
        id: 123,
        name: 'Test Part',
        sku: '3001',
        quantity: 1,
        price: '1.00',
        total: '1.00',
        condition: 'used',
      };

      const result = normalizeOrderItem(item, 'GBP');

      expect(result.condition).toBe('Used');
    });

    it('should handle color information', () => {
      const item: BricqerOrderItem = {
        id: 123,
        name: 'Red Brick',
        sku: '3001',
        quantity: 1,
        price: '1.00',
        total: '1.00',
        color_id: 5,
        color: 'Red',
      };

      const result = normalizeOrderItem(item, 'GBP');

      expect(result.colorId).toBe(5);
      expect(result.colorName).toBe('Red');
    });

    it('should default quantity to 1 when not provided', () => {
      // Use type assertion since we're testing behavior when quantity is missing
      const item = {
        id: 123,
        name: 'Test Part',
        sku: '3001',
        price: '1.00',
        total: '1.00',
      } as BricqerOrderItem;

      const result = normalizeOrderItem(item, 'GBP');

      expect(result.quantity).toBe(1);
    });

    it('should default item name to Unknown Item when not provided', () => {
      // Use type assertion since we're testing behavior when name is missing
      const item = {
        id: 123,
        sku: '3001',
        quantity: 1,
        price: '1.00',
        total: '1.00',
      } as BricqerOrderItem;

      const result = normalizeOrderItem(item, 'GBP');

      expect(result.itemName).toBe('Unknown Item');
    });

    it('should default item type to Part when not provided', () => {
      const item: BricqerOrderItem = {
        id: 123,
        name: 'Test Part',
        sku: '3001',
        quantity: 1,
        price: '1.00',
        total: '1.00',
      };

      const result = normalizeOrderItem(item, 'GBP');

      expect(result.itemType).toBe('Part');
    });
  });

  describe('normalizeOrder', () => {
    const baseOrder: BricqerOrder = {
      id: 1,
      order_number: 'BQ-001',
      displayName: 'BQ-001',
      status: 'READY',
      currency: 'GBP',
      costSubtotal: '100.00',
      costGrandtotal: '105.00',
      created: '2024-12-20T10:00:00Z',
      contact: {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
        address: '123 Main St\nLondon\nSW1A 1AA London',
      },
    };

    it('should normalize a basic order', () => {
      const result = normalizeOrder(baseOrder);

      expect(result.platformOrderId).toBe('BQ-001');
      expect(result.platform).toBe('bricqer');
      expect(result.status).toBe('Paid');
      expect(result.buyerName).toBe('John Doe');
      expect(result.buyerEmail).toBe('john@example.com');
      expect(result.subtotal).toBe(100);
      expect(result.total).toBe(105);
      expect(result.currency).toBe('GBP');
    });

    it('should normalize status from uppercase READY to Paid', () => {
      const order = { ...baseOrder, status: 'READY' as const };
      const result = normalizeOrder(order);
      expect(result.status).toBe('Paid');
    });

    it('should normalize status from SHIPPED', () => {
      const order = { ...baseOrder, status: 'SHIPPED' as const };
      const result = normalizeOrder(order);
      expect(result.status).toBe('Shipped');
    });

    it('should normalize status from PICKED to Packed', () => {
      const order = { ...baseOrder, status: 'PICKED' as const };
      const result = normalizeOrder(order);
      expect(result.status).toBe('Packed');
    });

    it('should normalize status from CANCELLED', () => {
      const order = { ...baseOrder, status: 'CANCELLED' as const };
      const result = normalizeOrder(order);
      expect(result.status).toBe('Cancelled/Refunded');
    });

    it('should normalize status from DELIVERED', () => {
      const order = { ...baseOrder, status: 'DELIVERED' as const };
      const result = normalizeOrder(order);
      expect(result.status).toBe('Completed');
    });

    it('should use displayName as order ID when order_number is missing', () => {
      const order = { ...baseOrder, order_number: undefined, displayName: 'DISPLAY-123' };
      const result = normalizeOrder(order);
      expect(result.platformOrderId).toBe('DISPLAY-123');
    });

    it('should fallback to id when neither order_number nor displayName available', () => {
      const order = { ...baseOrder, order_number: undefined, displayName: undefined };
      const result = normalizeOrder(order);
      expect(result.platformOrderId).toBe('1');
    });

    it('should extract buyer name from journal.contact for detailed orders', () => {
      const detailOrder: BricqerOrderDetail = {
        ...baseOrder,
        journal: {
          id: 100,
          contact: {
            id: 2,
            contactType: 'customer',
            name: 'Jane Smith',
            email: 'jane@example.com',
            address: '456 Oak St\nManchester\nM1 1AA Manchester',
          },
        },
        items: [],
      };

      const result = normalizeOrder(detailOrder);
      expect(result.buyerName).toBe('Jane Smith');
      expect(result.buyerEmail).toBe('jane@example.com');
    });

    it('should get buyer name from customer_name field', () => {
      const order = {
        ...baseOrder,
        contact: undefined,
        customer_name: 'Bob Wilson',
      };

      const result = normalizeOrder(order);
      expect(result.buyerName).toBe('Bob Wilson');
    });

    it('should construct buyer name from shipping address names', () => {
      const order = {
        ...baseOrder,
        contact: undefined,
        shipping_address: {
          first_name: 'Alice',
          last_name: 'Johnson',
          address_1: '789 Pine St',
          city: 'Birmingham',
          postcode: 'B1 1AA',
          country_code: 'GB',
        },
      };

      const result = normalizeOrder(order);
      expect(result.buyerName).toBe('Alice Johnson');
    });

    it('should return Unknown when no buyer info available', () => {
      const order = {
        ...baseOrder,
        contact: undefined,
        customer_name: undefined,
        shipping_address: undefined,
      };

      const result = normalizeOrder(order);
      expect(result.buyerName).toBe('Unknown');
    });

    it('should parse shipping address from journal.contact.address', () => {
      const detailOrder: BricqerOrderDetail = {
        ...baseOrder,
        journal: {
          id: 101,
          contact: {
            id: 3,
            contactType: 'customer',
            name: 'Jane Smith',
            address: '123 High Street\nFlat 2B\nSW1A 1AA London',
          },
        },
        items: [],
      };

      const result = normalizeOrder(detailOrder);

      expect(result.shippingAddress?.name).toBe('Jane Smith');
      expect(result.shippingAddress?.address1).toBe('123 High Street');
      expect(result.shippingAddress?.address2).toBe('Flat 2B');
      expect(result.shippingAddress?.postalCode).toBe('SW1A 1AA');
      expect(result.shippingAddress?.city).toBe('London');
    });

    it('should use shipping_address object when contact address not available', () => {
      const order = {
        ...baseOrder,
        contact: undefined,
        shipping_address: {
          name: 'Test User',
          address_1: '100 Test Road',
          address_2: 'Suite 5',
          city: 'Leeds',
          state: 'West Yorkshire',
          postcode: 'LS1 1AA',
          country_code: 'GB',
        },
      };

      const result = normalizeOrder(order);

      expect(result.shippingAddress?.name).toBe('Test User');
      expect(result.shippingAddress?.address1).toBe('100 Test Road');
      expect(result.shippingAddress?.address2).toBe('Suite 5');
      expect(result.shippingAddress?.city).toBe('Leeds');
      expect(result.shippingAddress?.postalCode).toBe('LS1 1AA');
      expect(result.shippingAddress?.countryCode).toBe('GB');
    });

    it('should include shipping costs from costShipping field', () => {
      const detailOrder: BricqerOrderDetail = {
        ...baseOrder,
        costShipping: '5.99',
        items: [],
      };

      const result = normalizeOrder(detailOrder);
      expect(result.shipping).toBe(5.99);
    });

    it('should include tax in fees', () => {
      const detailOrder: BricqerOrderDetail = {
        ...baseOrder,
        costTax: '20.00',
        items: [],
      };

      const result = normalizeOrder(detailOrder);
      expect(result.fees).toBe(20);
    });

    it('should normalize order items', () => {
      const items: BricqerOrderItem[] = [
        {
          id: 1,
          name: 'Item 1',
          sku: 'SKU-1',
          quantity: 2,
          price: '5.00',
          total: '10.00',
        },
        {
          id: 2,
          name: 'Item 2',
          sku: 'SKU-2',
          quantity: 1,
          price: '15.00',
          total: '15.00',
        },
      ];

      const result = normalizeOrder(baseOrder, items);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].itemNumber).toBe('SKU-1');
      expect(result.items[1].itemNumber).toBe('SKU-2');
    });

    it('should use items from order detail when not passed separately', () => {
      const detailOrder: BricqerOrderDetail = {
        ...baseOrder,
        items: [
          {
            id: 1,
            name: 'Item From Detail',
            sku: 'DETAIL-SKU',
            quantity: 1,
            price: '10.00',
            total: '10.00',
          },
        ],
      };

      const result = normalizeOrder(detailOrder);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].itemNumber).toBe('DETAIL-SKU');
    });

    it('should include lotCount when available', () => {
      const order = { ...baseOrder, lotCount: 15 };
      const result = normalizeOrder(order);
      expect(result.lotCount).toBe(15);
    });

    it('should calculate pieceCount from batchSet', () => {
      const baseItemSet = {
        id: 1,
        definitionId: 100,
        description: 'Test Part',
        legoType: 'Part',
        legoId: '3001',
        legoIdFull: '3001',
        condition: 'N' as const,
        price: 0.5,
      };

      const detailOrder: BricqerOrderDetail = {
        ...baseOrder,
        batchSet: [
          {
            id: 1,
            itemSet: [
              { ...baseItemSet, id: 1, quantity: 5 },
              { ...baseItemSet, id: 2, quantity: 10 },
            ],
          },
          {
            id: 2,
            itemSet: [
              { ...baseItemSet, id: 3, quantity: 3 },
            ],
          },
        ],
        items: [],
      };

      const result = normalizeOrder(detailOrder);
      expect(result.pieceCount).toBe(18);
    });

    it('should include tracking number when available', () => {
      const order = { ...baseOrder, tracking_number: 'TRACK123456' };
      const result = normalizeOrder(order);
      expect(result.trackingNumber).toBe('TRACK123456');
    });

    it('should parse order date from paymentDate', () => {
      const order = { ...baseOrder, paymentDate: '2024-12-25T14:30:00Z' };
      const result = normalizeOrder(order);
      expect(result.orderDate.toISOString()).toBe('2024-12-25T14:30:00.000Z');
    });

    it('should parse order date from created field', () => {
      const result = normalizeOrder(baseOrder);
      expect(result.orderDate.toISOString()).toBe('2024-12-20T10:00:00.000Z');
    });

    it('should default currency to GBP when not provided', () => {
      const order = { ...baseOrder, currency: undefined };
      const result = normalizeOrder(order);
      expect(result.currency).toBe('GBP');
    });

    it('should include order description when available', () => {
      const detailOrder: BricqerOrderDetail = {
        ...baseOrder,
        description: 'Special order notes',
        items: [],
      };

      const result = normalizeOrder(detailOrder);
      expect(result.orderDescription).toBe('Special order notes');
    });

    it('should preserve raw data', () => {
      const result = normalizeOrder(baseOrder);
      expect(result.rawData).toBeDefined();
      expect(result.rawData.id).toBe(1);
    });
  });

  describe('normalizeOrders', () => {
    it('should normalize multiple orders', () => {
      const orders: BricqerOrder[] = [
        {
          id: 1,
          order_number: 'BQ-001',
          status: 'READY',
          currency: 'GBP',
          costGrandtotal: '100.00',
          created: '2024-12-20T10:00:00Z',
        },
        {
          id: 2,
          order_number: 'BQ-002',
          status: 'SHIPPED',
          currency: 'EUR',
          costGrandtotal: '150.00',
          created: '2024-12-21T10:00:00Z',
        },
      ];

      const results = normalizeOrders(orders);

      expect(results).toHaveLength(2);
      expect(results[0].platformOrderId).toBe('BQ-001');
      expect(results[1].platformOrderId).toBe('BQ-002');
    });

    it('should return empty array for empty input', () => {
      const results = normalizeOrders([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('calculateOrderStats', () => {
    const orders: NormalizedBricqerOrder[] = [
      {
        platformOrderId: 'BQ-001',
        platform: 'bricqer',
        orderDate: new Date(),
        status: 'Paid',
        buyerName: 'John',
        subtotal: 80,
        shipping: 10,
        fees: 10,
        total: 100,
        currency: 'GBP',
        items: [
          { itemNumber: '1', itemName: 'Item 1', itemType: 'Part', quantity: 5, condition: 'New', unitPrice: 10, totalPrice: 50, currency: 'GBP' },
          { itemNumber: '2', itemName: 'Item 2', itemType: 'Part', quantity: 3, condition: 'Used', unitPrice: 10, totalPrice: 30, currency: 'GBP' },
        ],
        rawData: {} as BricqerOrderDetail,
      },
      {
        platformOrderId: 'BQ-002',
        platform: 'bricqer',
        orderDate: new Date(),
        status: 'Shipped',
        buyerName: 'Jane',
        subtotal: 150,
        shipping: 20,
        fees: 30,
        total: 200,
        currency: 'GBP',
        items: [
          { itemNumber: '3', itemName: 'Item 3', itemType: 'Set', quantity: 2, condition: 'New', unitPrice: 75, totalPrice: 150, currency: 'GBP' },
        ],
        rawData: {} as BricqerOrderDetail,
      },
      {
        platformOrderId: 'BQ-003',
        platform: 'bricqer',
        orderDate: new Date(),
        status: 'Paid',
        buyerName: 'Bob',
        subtotal: 45,
        shipping: 5,
        fees: 0,
        total: 50,
        currency: 'GBP',
        items: [],
        rawData: {} as BricqerOrderDetail,
      },
    ];

    it('should calculate total orders', () => {
      const stats = calculateOrderStats(orders);
      expect(stats.totalOrders).toBe(3);
    });

    it('should calculate total revenue', () => {
      const stats = calculateOrderStats(orders);
      expect(stats.totalRevenue).toBe(350);
    });

    it('should calculate total items', () => {
      const stats = calculateOrderStats(orders);
      expect(stats.totalItems).toBe(10);
    });

    it('should calculate average order value', () => {
      const stats = calculateOrderStats(orders);
      expect(stats.averageOrderValue).toBeCloseTo(116.67, 1);
    });

    it('should calculate status breakdown', () => {
      const stats = calculateOrderStats(orders);
      expect(stats.statusBreakdown).toEqual({
        Paid: 2,
        Shipped: 1,
      });
    });

    it('should handle empty orders array', () => {
      const stats = calculateOrderStats([]);
      expect(stats.totalOrders).toBe(0);
      expect(stats.totalRevenue).toBe(0);
      expect(stats.totalItems).toBe(0);
      expect(stats.averageOrderValue).toBe(0);
      expect(stats.statusBreakdown).toEqual({});
    });
  });

  describe('normalizeInventoryItem', () => {
    const baseItem: BricqerInventoryItem = {
      id: 1,
      storageId: 1,
      definitionTypeId: 1,
      definitionId: 100,
      batchId: 10,
      quantity: 5,
      remainingQuantity: 5,
      price: '2.50',
      condition: 'N',
      storageLabel: 'Shelf A1',
      definition: {
        legoId: '3001',
        legoIdFull: '3001',
        description: 'Red Brick 2x4',
        legoType: 'P',
        condition: 'N',
        price: 2.5,
        color: {
          id: 5,
          rgb: 'FF0000',
          name: 'Red',
        },
        picture: 'https://example.com/brick.jpg',
      },
    };

    it('should return null for items with no definition', () => {
      const item = { ...baseItem, definition: null } as unknown as BricqerInventoryItem;
      const result = normalizeInventoryItem(item);
      expect(result).toBeNull();
    });

    it('should normalize a basic inventory item', () => {
      const result = normalizeInventoryItem(baseItem)!;

      expect(result.externalId).toBe('1');
      expect(result.itemNumber).toBe('3001');
      expect(result.itemName).toBe('Red Brick 2x4');
      expect(result.itemType).toBe('Part');
      expect(result.colorId).toBe(5);
      expect(result.colorName).toBe('Red');
      expect(result.condition).toBe('New');
      expect(result.quantity).toBe(5);
      expect(result.price).toBe(2.5);
      expect(result.storageLocation).toBe('Shelf A1');
      expect(result.batchId).toBe(10);
    });

    it('should map legoType P to Part', () => {
      const item = { ...baseItem, definition: { ...baseItem.definition, legoType: 'P' } };
      const result = normalizeInventoryItem(item)!;
      expect(result.itemType).toBe('Part');
    });

    it('should map legoType S to Set', () => {
      const item = { ...baseItem, definition: { ...baseItem.definition, legoType: 'S' } };
      const result = normalizeInventoryItem(item)!;
      expect(result.itemType).toBe('Set');
    });

    it('should map legoType M to Minifig', () => {
      const item = { ...baseItem, definition: { ...baseItem.definition, legoType: 'M' } };
      const result = normalizeInventoryItem(item)!;
      expect(result.itemType).toBe('Minifig');
    });

    it('should map other legoTypes to Other', () => {
      const types = ['G', 'B', 'C', 'I', 'O'];
      for (const type of types) {
        const item = { ...baseItem, definition: { ...baseItem.definition, legoType: type } };
        const result = normalizeInventoryItem(item)!;
        expect(result.itemType).toBe('Other');
      }
    });

    it('should map condition N to New', () => {
      const item = { ...baseItem, condition: 'N' as const };
      const result = normalizeInventoryItem(item)!;
      expect(result.condition).toBe('New');
    });

    it('should map condition U to Used', () => {
      const item = { ...baseItem, condition: 'U' as const };
      const result = normalizeInventoryItem(item)!;
      expect(result.condition).toBe('Used');
    });

    it('should default condition to New when undefined', () => {
      const item = { ...baseItem, condition: undefined };
      const result = normalizeInventoryItem(item)!;
      expect(result.condition).toBe('New');
    });

    it('should use remainingQuantity when quantity not available', () => {
      const item = { ...baseItem, quantity: undefined, remainingQuantity: 3 };
      const result = normalizeInventoryItem(item)!;
      expect(result.quantity).toBe(3);
    });

    it('should default quantity to 1 when neither available', () => {
      const item = { ...baseItem, quantity: undefined, remainingQuantity: undefined };
      const result = normalizeInventoryItem(item)!;
      expect(result.quantity).toBe(1);
    });

    it('should use colorId from item when available', () => {
      const item = { ...baseItem, colorId: 10, colorName: 'Blue' };
      const result = normalizeInventoryItem(item)!;
      expect(result.colorId).toBe(10);
      expect(result.colorName).toBe('Blue');
    });

    it('should use price from definition when item price not available', () => {
      const item = { ...baseItem, price: undefined };
      const result = normalizeInventoryItem(item)!;
      expect(result.price).toBe(2.5);
    });

    it('should fallback to definitionId when legoId not available', () => {
      const item = {
        ...baseItem,
        definition: { ...baseItem.definition, legoId: undefined },
      } as unknown as BricqerInventoryItem;
      const result = normalizeInventoryItem(item)!;
      expect(result.itemNumber).toBe('100');
    });

    it('should include image URL from picture field', () => {
      const result = normalizeInventoryItem(baseItem)!;
      expect(result.imageUrl).toBe('https://example.com/brick.jpg');
    });

    it('should use legoPicture when picture not available', () => {
      const item = {
        ...baseItem,
        definition: {
          ...baseItem.definition,
          picture: undefined,
          legoPicture: 'https://example.com/lego-brick.jpg',
        },
      };
      const result = normalizeInventoryItem(item)!;
      expect(result.imageUrl).toBe('https://example.com/lego-brick.jpg');
    });

    it('should include purchaseId when available', () => {
      const item = { ...baseItem, purchaseId: 999 };
      const result = normalizeInventoryItem(item)!;
      expect(result.purchaseId).toBe(999);
    });

    it('should include remarks when available', () => {
      const item = { ...baseItem, remarks: 'Some notes about this item' };
      const result = normalizeInventoryItem(item)!;
      expect(result.remarks).toBe('Some notes about this item');
    });

    it('should preserve raw data', () => {
      const result = normalizeInventoryItem(baseItem)!;
      expect(result.rawData).toBeDefined();
      expect(result.rawData.id).toBe(1);
    });

    it('should default itemName to Unknown Item when description not available', () => {
      const item = {
        ...baseItem,
        definition: { ...baseItem.definition, description: undefined },
      } as unknown as BricqerInventoryItem;
      const result = normalizeInventoryItem(item)!;
      expect(result.itemName).toBe('Unknown Item');
    });
  });

  describe('normalizeInventoryItems', () => {
    it('should normalize multiple inventory items', () => {
      const items: BricqerInventoryItem[] = [
        {
          id: 1,
          storageId: 1,
          storageLabel: 'Shelf A',
          definitionTypeId: 1,
          definitionId: 100,
          quantity: 5,
          definition: {
            legoId: '3001',
            legoIdFull: '3001',
            description: 'Item 1',
            legoType: 'P',
            condition: 'N',
          },
        },
        {
          id: 2,
          storageId: 2,
          storageLabel: 'Shelf B',
          definitionTypeId: 2,
          definitionId: 200,
          quantity: 10,
          definition: {
            legoId: '3002',
            legoIdFull: '3002',
            description: 'Item 2',
            legoType: 'S',
            condition: 'U',
          },
        },
      ];

      const results = normalizeInventoryItems(items);

      expect(results).toHaveLength(2);
      expect(results[0].itemNumber).toBe('3001');
      expect(results[1].itemNumber).toBe('3002');
    });

    it('should return empty array for empty input', () => {
      const results = normalizeInventoryItems([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('calculateInventoryStats', () => {
    const items: NormalizedBricqerInventoryItem[] = [
      {
        externalId: '1',
        itemNumber: '3001',
        itemName: 'Red Brick',
        itemType: 'Part' as const,
        condition: 'New' as const,
        quantity: 100,
        price: 0.1,
        storageLocation: 'Shelf A',
        rawData: {} as BricqerInventoryItem,
      },
      {
        externalId: '2',
        itemNumber: '3002',
        itemName: 'Blue Brick',
        itemType: 'Part' as const,
        condition: 'Used' as const,
        quantity: 50,
        price: 0.05,
        storageLocation: 'Shelf B',
        rawData: {} as BricqerInventoryItem,
      },
      {
        externalId: '3',
        itemNumber: '75192',
        itemName: 'Millennium Falcon',
        itemType: 'Set' as const,
        condition: 'New' as const,
        quantity: 1,
        price: 500,
        storageLocation: 'Shelf C',
        rawData: {} as BricqerInventoryItem,
      },
    ];

    it('should calculate total lots', () => {
      const stats = calculateInventoryStats(items);
      expect(stats.totalLots).toBe(3);
    });

    it('should calculate total quantity', () => {
      const stats = calculateInventoryStats(items);
      expect(stats.totalQuantity).toBe(151);
    });

    it('should calculate total value', () => {
      const stats = calculateInventoryStats(items);
      // 100 * 0.1 + 50 * 0.05 + 1 * 500 = 10 + 2.5 + 500 = 512.5
      expect(stats.totalValue).toBe(512.5);
    });

    it('should calculate condition breakdown', () => {
      const stats = calculateInventoryStats(items);
      expect(stats.conditionBreakdown).toEqual({
        New: 101,
        Used: 50,
      });
    });

    it('should calculate type breakdown', () => {
      const stats = calculateInventoryStats(items);
      expect(stats.typeBreakdown).toEqual({
        Part: 150,
        Set: 1,
      });
    });

    it('should handle empty items array', () => {
      const stats = calculateInventoryStats([]);
      expect(stats.totalLots).toBe(0);
      expect(stats.totalQuantity).toBe(0);
      expect(stats.totalValue).toBe(0);
      expect(stats.conditionBreakdown).toEqual({});
      expect(stats.typeBreakdown).toEqual({});
    });

    it('should handle items without price', () => {
      const itemsWithoutPrice: NormalizedBricqerInventoryItem[] = [
        {
          externalId: '1',
          itemNumber: '3001',
          itemName: 'Test',
          itemType: 'Part' as const,
          condition: 'New' as const,
          quantity: 10,
          price: undefined,
          storageLocation: 'Shelf A',
          rawData: {} as BricqerInventoryItem,
        },
      ];

      const stats = calculateInventoryStats(itemsWithoutPrice);
      expect(stats.totalValue).toBe(0);
    });
  });
});
