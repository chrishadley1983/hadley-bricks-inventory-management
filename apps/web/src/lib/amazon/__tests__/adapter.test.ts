import { describe, it, expect } from 'vitest';
import { normalizeOrder, normalizeOrders } from '../adapter';
import type { AmazonOrder, AmazonOrderItem } from '../types';

describe('Amazon Adapter', () => {
  describe('normalizeOrder', () => {
    const createMockOrder = (overrides: Partial<AmazonOrder> = {}): AmazonOrder => ({
      AmazonOrderId: '123-456-789',
      PurchaseDate: '2024-01-15T10:30:00Z',
      LastUpdateDate: '2024-01-15T12:00:00Z',
      OrderStatus: 'Shipped',
      FulfillmentChannel: 'MFN',
      MarketplaceId: 'A1F83G8C2ARO7P', // UK
      OrderTotal: { Amount: '100.00', CurrencyCode: 'GBP' },
      ShippingAddress: {
        Name: 'John Smith',
        AddressLine1: '123 Test Street',
        AddressLine2: 'Flat 4',
        City: 'London',
        StateOrRegion: 'Greater London',
        PostalCode: 'SW1A 1AA',
        CountryCode: 'GB',
      },
      BuyerInfo: {
        BuyerName: 'John Smith',
        BuyerEmail: 'john.smith@example.com',
      },
      ...overrides,
    });

    const createMockOrderItem = (overrides: Partial<AmazonOrderItem> = {}): AmazonOrderItem => ({
      ASIN: 'B09ABC123',
      OrderItemId: 'item-001',
      SellerSKU: 'LEGO-75192',
      Title: 'LEGO Star Wars Millennium Falcon 75192',
      QuantityOrdered: 1,
      ItemPrice: { Amount: '95.00', CurrencyCode: 'GBP' },
      ShippingPrice: { Amount: '5.00', CurrencyCode: 'GBP' },
      ...overrides,
    });

    describe('basic order normalization', () => {
      it('should normalize a basic order with all fields', () => {
        const order = createMockOrder();
        const items = [createMockOrderItem()];

        const result = normalizeOrder(order, items);

        expect(result.platformOrderId).toBe('123-456-789');
        expect(result.orderDate).toEqual(new Date('2024-01-15T10:30:00Z'));
        expect(result.buyerName).toBe('John Smith');
        expect(result.buyerEmail).toBe('john.smith@example.com');
        expect(result.status).toBe('Shipped');
        expect(result.currency).toBe('GBP');
        expect(result.marketplace).toBe('Amazon UK');
        expect(result.marketplaceId).toBe('A1F83G8C2ARO7P');
        expect(result.fulfillmentChannel).toBe('FBM');
      });

      it('should calculate subtotal from OrderTotal', () => {
        const order = createMockOrder({
          OrderTotal: { Amount: '150.00', CurrencyCode: 'GBP' },
        });

        const result = normalizeOrder(order);

        expect(result.subtotal).toBe(150);
        expect(result.total).toBe(150);
      });

      it('should calculate shipping from items', () => {
        const order = createMockOrder();
        const items = [
          createMockOrderItem({ ShippingPrice: { Amount: '5.00', CurrencyCode: 'GBP' } }),
          createMockOrderItem({ ShippingPrice: { Amount: '3.00', CurrencyCode: 'GBP' } }),
        ];

        const result = normalizeOrder(order, items);

        expect(result.shipping).toBe(8);
      });

      it('should set fees to 0 as Amazon deducts from payouts', () => {
        const order = createMockOrder();

        const result = normalizeOrder(order);

        expect(result.fees).toBe(0);
      });

      it('should include raw order data', () => {
        const order = createMockOrder();

        const result = normalizeOrder(order);

        expect(result.rawData).toEqual(order);
      });
    });

    describe('status normalization', () => {
      it.each([
        ['Pending', 'Pending'],
        ['Unshipped', 'Paid'],
        ['PartiallyShipped', 'Partially Shipped'],
        ['Shipped', 'Shipped'],
        ['Canceled', 'Cancelled/Refunded'],
        ['Unfulfillable', 'Cancelled/Refunded'],
        ['InvoiceUnconfirmed', 'Pending'],
        ['PendingAvailability', 'Pending'],
      ])('should normalize status %s to %s', (amazonStatus, expectedStatus) => {
        const order = createMockOrder({ OrderStatus: amazonStatus as AmazonOrder['OrderStatus'] });

        const result = normalizeOrder(order);

        expect(result.status).toBe(expectedStatus);
      });

      it('should pass through unknown statuses as-is', () => {
        const order = createMockOrder({
          OrderStatus: 'UnknownStatus' as AmazonOrder['OrderStatus'],
        });

        const result = normalizeOrder(order);

        expect(result.status).toBe('UnknownStatus');
      });
    });

    describe('fulfillment channel normalization', () => {
      it('should normalize MFN to FBM', () => {
        const order = createMockOrder({ FulfillmentChannel: 'MFN' });

        const result = normalizeOrder(order);

        expect(result.fulfillmentChannel).toBe('FBM');
      });

      it('should normalize AFN to FBA', () => {
        const order = createMockOrder({ FulfillmentChannel: 'AFN' });

        const result = normalizeOrder(order);

        expect(result.fulfillmentChannel).toBe('FBA');
      });
    });

    describe('marketplace handling', () => {
      it.each([
        ['A1F83G8C2ARO7P', 'Amazon UK', 'GBP'],
        ['A1PA6795UKMFR9', 'Amazon DE', 'EUR'],
        ['A13V1IB3VIYBER', 'Amazon FR', 'EUR'],
        ['APJ6JRA9NG5V4', 'Amazon IT', 'EUR'],
        ['A1RKKUPIHCS9HS', 'Amazon ES', 'EUR'],
        ['ATVPDKIKX0DER', 'Amazon US', 'USD'],
        ['A2EUQ1WTGCTBG2', 'Amazon CA', 'CAD'],
      ])(
        'should handle %s marketplace correctly',
        (marketplaceId, expectedName, expectedCurrency) => {
          const order = createMockOrder({
            MarketplaceId: marketplaceId,
            OrderTotal: undefined, // Force fallback to marketplace currency
          });

          const result = normalizeOrder(order);

          expect(result.marketplace).toBe(expectedName);
          expect(result.currency).toBe(expectedCurrency);
        }
      );

      it('should handle unknown marketplace ID', () => {
        const order = createMockOrder({ MarketplaceId: 'UNKNOWN123' });

        const result = normalizeOrder(order);

        expect(result.marketplace).toBe('Amazon (UNKNOWN123)');
      });

      it('should use OrderTotal currency over marketplace fallback', () => {
        const order = createMockOrder({
          MarketplaceId: 'A1F83G8C2ARO7P', // UK - GBP
          OrderTotal: { Amount: '100.00', CurrencyCode: 'USD' },
        });

        const result = normalizeOrder(order);

        expect(result.currency).toBe('USD');
      });
    });

    describe('shipping address normalization', () => {
      it('should normalize complete shipping address', () => {
        const order = createMockOrder({
          ShippingAddress: {
            Name: 'John Smith',
            AddressLine1: '123 Main Street',
            AddressLine2: 'Apartment 4B',
            AddressLine3: 'Building C',
            City: 'Manchester',
            StateOrRegion: 'Greater Manchester',
            PostalCode: 'M1 1AA',
            CountryCode: 'GB',
          },
        });

        const result = normalizeOrder(order);

        expect(result.shippingAddress).toEqual({
          name: 'John Smith',
          address1: '123 Main Street',
          address2: 'Apartment 4B, Building C',
          city: 'Manchester',
          state: 'Greater Manchester',
          postalCode: 'M1 1AA',
          countryCode: 'GB',
        });
      });

      it('should handle address with only AddressLine2', () => {
        const order = createMockOrder({
          ShippingAddress: {
            Name: 'Jane Doe',
            AddressLine1: '456 Oak Road',
            AddressLine2: 'Suite 100',
            City: 'Birmingham',
            PostalCode: 'B1 1AA',
            CountryCode: 'GB',
          },
        });

        const result = normalizeOrder(order);

        expect(result.shippingAddress?.address2).toBe('Suite 100');
      });

      it('should handle missing shipping address', () => {
        const order = createMockOrder({ ShippingAddress: undefined });

        const result = normalizeOrder(order);

        expect(result.shippingAddress).toBeUndefined();
      });

      it('should use BuyerInfo name as fallback when address name is missing', () => {
        const order = createMockOrder({
          ShippingAddress: {
            AddressLine1: '123 Test',
            City: 'London',
            CountryCode: 'GB',
          },
          BuyerInfo: { BuyerName: 'Buyer From Info' },
        });

        const result = normalizeOrder(order);

        expect(result.shippingAddress?.name).toBe('Buyer From Info');
      });

      it('should default country code to GB when missing', () => {
        const order = createMockOrder({
          ShippingAddress: {
            Name: 'Test User',
            AddressLine1: '123 Test',
          },
        });

        const result = normalizeOrder(order);

        expect(result.shippingAddress?.countryCode).toBe('GB');
      });
    });

    describe('buyer info handling', () => {
      it('should prefer BuyerInfo name over shipping address', () => {
        const order = createMockOrder({
          BuyerInfo: { BuyerName: 'Buyer Name' },
          ShippingAddress: { Name: 'Recipient Name' },
        });

        const result = normalizeOrder(order);

        expect(result.buyerName).toBe('Buyer Name');
      });

      it('should fall back to shipping address name', () => {
        const order = createMockOrder({
          BuyerInfo: undefined,
          ShippingAddress: { Name: 'Recipient Name' },
        });

        const result = normalizeOrder(order);

        expect(result.buyerName).toBe('Recipient Name');
      });

      it('should default to Amazon Customer when no buyer info', () => {
        const order = createMockOrder({
          BuyerInfo: undefined,
          ShippingAddress: undefined,
        });

        const result = normalizeOrder(order);

        expect(result.buyerName).toBe('Amazon Customer');
      });

      it('should include buyer email when available', () => {
        const order = createMockOrder({
          BuyerInfo: { BuyerEmail: 'test@example.com' },
        });

        const result = normalizeOrder(order);

        expect(result.buyerEmail).toBe('test@example.com');
      });
    });

    describe('order items normalization', () => {
      it('should normalize order items correctly', () => {
        const order = createMockOrder();
        const items = [createMockOrderItem()];

        const result = normalizeOrder(order, items);

        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toEqual({
          asin: 'B09ABC123',
          sku: 'LEGO-75192',
          title: 'LEGO Star Wars Millennium Falcon 75192',
          quantity: 1,
          unitPrice: 95,
          totalPrice: 95,
          currency: 'GBP',
        });
      });

      it('should calculate unit price from total and quantity', () => {
        const order = createMockOrder();
        const items = [
          createMockOrderItem({
            QuantityOrdered: 2,
            ItemPrice: { Amount: '100.00', CurrencyCode: 'GBP' },
          }),
        ];

        const result = normalizeOrder(order, items);

        expect(result.items[0].unitPrice).toBe(50);
        expect(result.items[0].totalPrice).toBe(100);
      });

      it('should handle items without SKU', () => {
        const order = createMockOrder();
        const items = [createMockOrderItem({ SellerSKU: undefined })];

        const result = normalizeOrder(order, items);

        expect(result.items[0].sku).toBeUndefined();
      });

      it('should use ASIN as title fallback when title is missing', () => {
        const order = createMockOrder();
        const items = [createMockOrderItem({ Title: undefined })];

        const result = normalizeOrder(order, items);

        expect(result.items[0].title).toBe('ASIN: B09ABC123');
      });

      it('should handle empty items array', () => {
        const order = createMockOrder();

        const result = normalizeOrder(order, []);

        expect(result.items).toHaveLength(0);
        expect(result.shipping).toBe(0);
      });

      it('should handle multiple items', () => {
        const order = createMockOrder();
        const items = [
          createMockOrderItem({ ASIN: 'B001', Title: 'Item 1' }),
          createMockOrderItem({ ASIN: 'B002', Title: 'Item 2' }),
          createMockOrderItem({ ASIN: 'B003', Title: 'Item 3' }),
        ];

        const result = normalizeOrder(order, items);

        expect(result.items).toHaveLength(3);
        expect(result.items.map((i) => i.asin)).toEqual(['B001', 'B002', 'B003']);
      });
    });

    describe('amount parsing', () => {
      it('should handle missing OrderTotal', () => {
        const order = createMockOrder({ OrderTotal: undefined });

        const result = normalizeOrder(order);

        expect(result.subtotal).toBe(0);
        expect(result.total).toBe(0);
      });

      it('should handle missing item prices', () => {
        const order = createMockOrder();
        const items = [createMockOrderItem({ ItemPrice: undefined, ShippingPrice: undefined })];

        const result = normalizeOrder(order, items);

        expect(result.items[0].totalPrice).toBe(0);
        expect(result.shipping).toBe(0);
      });

      it('should handle non-numeric amounts gracefully', () => {
        const order = createMockOrder({
          OrderTotal: { Amount: 'invalid', CurrencyCode: 'GBP' },
        });

        const result = normalizeOrder(order);

        expect(result.subtotal).toBe(0);
      });
    });
  });

  describe('normalizeOrders', () => {
    it('should normalize multiple orders', () => {
      const orders: AmazonOrder[] = [
        {
          AmazonOrderId: 'order-1',
          PurchaseDate: '2024-01-15T10:00:00Z',
          LastUpdateDate: '2024-01-15T10:00:00Z',
          OrderStatus: 'Shipped',
          FulfillmentChannel: 'MFN',
          MarketplaceId: 'A1F83G8C2ARO7P',
        },
        {
          AmazonOrderId: 'order-2',
          PurchaseDate: '2024-01-16T10:00:00Z',
          LastUpdateDate: '2024-01-16T10:00:00Z',
          OrderStatus: 'Pending',
          FulfillmentChannel: 'AFN',
          MarketplaceId: 'A1F83G8C2ARO7P',
        },
      ];

      const result = normalizeOrders(orders);

      expect(result).toHaveLength(2);
      expect(result[0].platformOrderId).toBe('order-1');
      expect(result[1].platformOrderId).toBe('order-2');
    });

    it('should match items to orders by order ID', () => {
      const orders: AmazonOrder[] = [
        {
          AmazonOrderId: 'order-1',
          PurchaseDate: '2024-01-15T10:00:00Z',
          LastUpdateDate: '2024-01-15T10:00:00Z',
          OrderStatus: 'Shipped',
          FulfillmentChannel: 'MFN',
          MarketplaceId: 'A1F83G8C2ARO7P',
        },
      ];

      const itemsByOrderId = new Map<string, AmazonOrderItem[]>([
        [
          'order-1',
          [
            {
              ASIN: 'B001',
              OrderItemId: 'item-1',
              QuantityOrdered: 1,
              Title: 'Test Item',
            },
          ],
        ],
      ]);

      const result = normalizeOrders(orders, itemsByOrderId);

      expect(result[0].items).toHaveLength(1);
      expect(result[0].items[0].asin).toBe('B001');
    });

    it('should handle orders without matching items', () => {
      const orders: AmazonOrder[] = [
        {
          AmazonOrderId: 'order-1',
          PurchaseDate: '2024-01-15T10:00:00Z',
          LastUpdateDate: '2024-01-15T10:00:00Z',
          OrderStatus: 'Shipped',
          FulfillmentChannel: 'MFN',
          MarketplaceId: 'A1F83G8C2ARO7P',
        },
      ];

      const itemsByOrderId = new Map<string, AmazonOrderItem[]>([
        ['different-order-id', [{ ASIN: 'B001', OrderItemId: 'item-1', QuantityOrdered: 1 }]],
      ]);

      const result = normalizeOrders(orders, itemsByOrderId);

      expect(result[0].items).toHaveLength(0);
    });

    it('should handle empty orders array', () => {
      const result = normalizeOrders([]);

      expect(result).toHaveLength(0);
    });

    it('should handle undefined itemsByOrderId', () => {
      const orders: AmazonOrder[] = [
        {
          AmazonOrderId: 'order-1',
          PurchaseDate: '2024-01-15T10:00:00Z',
          LastUpdateDate: '2024-01-15T10:00:00Z',
          OrderStatus: 'Shipped',
          FulfillmentChannel: 'MFN',
          MarketplaceId: 'A1F83G8C2ARO7P',
        },
      ];

      const result = normalizeOrders(orders, undefined);

      expect(result).toHaveLength(1);
      expect(result[0].items).toHaveLength(0);
    });
  });
});
