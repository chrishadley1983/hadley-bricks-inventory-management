import { describe, it, expect, vi } from 'vitest';
import {
  parseAmazonListingsReport,
  getReportColumns,
  getColumnLabel,
} from '../amazon-report-parser';

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});

describe('Amazon Report Parser', () => {
  // ===========================================================================
  // parseAmazonListingsReport
  // ===========================================================================

  describe('parseAmazonListingsReport', () => {
    // Helper to create a valid TSV report
    const createReport = (rows: string[][], headers?: string[]): string => {
      const defaultHeaders = [
        'item-name',
        'item-description',
        'listing-id',
        'seller-sku',
        'price',
        'quantity',
        'open-date',
        'product-id-type',
        'item-note',
        'item-condition',
        'will-ship-internationally',
        'expedited-shipping',
        'product-id',
        'pending-quantity',
        'fulfillment-channel',
        'merchant-shipping-group',
        'status',
      ];
      const headerRow = (headers ?? defaultHeaders).join('\t');
      const dataRows = rows.map((row) => row.join('\t'));
      return [headerRow, ...dataRows].join('\n');
    };

    describe('basic parsing', () => {
      it('should parse a valid report with single listing', () => {
        const report = createReport([
          [
            'LEGO Star Wars Millennium Falcon 75192', // item-name
            'Ultimate collector edition', // item-description
            'L001', // listing-id
            'SKU-001', // seller-sku
            '799.99', // price
            '5', // quantity
            '2024-01-15', // open-date
            'ASIN', // product-id-type
            'Fast shipping', // item-note
            '11', // item-condition (11 = New)
            'y', // will-ship-internationally
            'n', // expedited-shipping
            'B07P6R8GV2', // product-id (ASIN)
            '0', // pending-quantity
            'AMAZON_EU', // fulfillment-channel
            'Standard', // merchant-shipping-group
            'Active', // status
          ],
        ]);

        const result = parseAmazonListingsReport(report);

        expect(result.listings).toHaveLength(1);
        expect(result.totalRows).toBe(1);
        expect(result.skippedRows).toBe(0);
        expect(result.errors).toHaveLength(0);

        const listing = result.listings[0];
        expect(listing.sellerSku).toBe('SKU-001');
        expect(listing.asin).toBe('B07P6R8GV2');
        expect(listing.title).toBe('LEGO Star Wars Millennium Falcon 75192');
        expect(listing.price).toBe(799.99);
        expect(listing.quantity).toBe(5);
        expect(listing.listingStatus).toBe('Active');
        expect(listing.fulfillmentChannel).toBe('FBA');
      });

      it('should parse multiple listings', () => {
        const report = createReport([
          [
            'Item 1', '', 'L001', 'SKU-001', '10.00', '5', '', '', '', '11', '', '', 'ASIN001', '0', 'DEFAULT', '', 'Active',
          ],
          [
            'Item 2', '', 'L002', 'SKU-002', '20.00', '3', '', '', '', '11', '', '', 'ASIN002', '0', 'AMAZON_EU', '', 'Active',
          ],
          [
            'Item 3', '', 'L003', 'SKU-003', '30.00', '8', '', '', '', '11', '', '', 'ASIN003', '0', 'DEFAULT', '', 'Inactive',
          ],
        ]);

        const result = parseAmazonListingsReport(report);

        expect(result.listings).toHaveLength(3);
        expect(result.totalRows).toBe(3);
        expect(result.skippedRows).toBe(0);

        expect(result.listings[0].sellerSku).toBe('SKU-001');
        expect(result.listings[1].sellerSku).toBe('SKU-002');
        expect(result.listings[2].sellerSku).toBe('SKU-003');
      });
    });

    describe('status mapping', () => {
      it('should map Active status', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].listingStatus).toBe('Active');
      });

      it('should map Inactive status', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', '', '', 'ASIN', '', '', '', 'Inactive'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].listingStatus).toBe('Inactive');
      });

      it('should map Incomplete status', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', '', '', 'ASIN', '', '', '', 'Incomplete'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].listingStatus).toBe('Incomplete');
      });

      it('should map Out of Stock status', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '0', '', '', '', '', '', '', 'ASIN', '', '', '', 'out of stock'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].listingStatus).toBe('Out of Stock');
      });

      it('should map hyphenated out-of-stock status', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '0', '', '', '', '', '', '', 'ASIN', '', '', '', 'out-of-stock'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].listingStatus).toBe('Out of Stock');
      });

      it('should map unknown status to Unknown', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', '', '', 'ASIN', '', '', '', 'some-other-status'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].listingStatus).toBe('Unknown');
      });

      it('should handle case-insensitive status', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', '', '', 'ASIN', '', '', '', 'ACTIVE'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].listingStatus).toBe('Active');
      });
    });

    describe('fulfillment channel mapping', () => {
      it('should map AMAZON_EU to FBA', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', '', '', 'ASIN', '', 'AMAZON_EU', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].fulfillmentChannel).toBe('FBA');
      });

      it('should map AMAZON_NA to FBA', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', '', '', 'ASIN', '', 'AMAZON_NA', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].fulfillmentChannel).toBe('FBA');
      });

      it('should map AFN to FBA', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', '', '', 'ASIN', '', 'AFN', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].fulfillmentChannel).toBe('FBA');
      });

      it('should map DEFAULT to FBM', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', '', '', 'ASIN', '', 'DEFAULT', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].fulfillmentChannel).toBe('FBM');
      });

      it('should map MFN to FBM', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', '', '', 'ASIN', '', 'MFN', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].fulfillmentChannel).toBe('FBM');
      });

      it('should return original value for unknown channel', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', '', '', 'ASIN', '', 'CUSTOM_CHANNEL', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].fulfillmentChannel).toBe('CUSTOM_CHANNEL');
      });

      it('should handle null fulfillment channel', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].fulfillmentChannel).toBeNull();
      });
    });

    describe('item condition mapping', () => {
      it('should map condition code 11 to New', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '11', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.itemCondition).toBe('New');
      });

      it('should map condition code 1 to Used - Like New', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '1', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.itemCondition).toBe('Used - Like New');
      });

      it('should map condition code 2 to Used - Very Good', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '2', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.itemCondition).toBe('Used - Very Good');
      });

      it('should map condition code 3 to Used - Good', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '3', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.itemCondition).toBe('Used - Good');
      });

      it('should map condition code 4 to Used - Acceptable', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '4', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.itemCondition).toBe('Used - Acceptable');
      });

      it('should map condition code 10 to Refurbished', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '10', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.itemCondition).toBe('Refurbished');
      });

      it('should map text "new" to New', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', 'new', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.itemCondition).toBe('New');
      });

      it('should return original value for unknown condition', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', 'custom-condition', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.itemCondition).toBe('custom-condition');
      });
    });

    describe('boolean field parsing', () => {
      it('should parse "y" as true', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', 'y', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.willShipInternationally).toBe(true);
      });

      it('should parse "yes" as true', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', 'yes', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.willShipInternationally).toBe(true);
      });

      it('should parse "true" as true', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', 'true', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.willShipInternationally).toBe(true);
      });

      it('should parse "n" as false', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', 'n', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.willShipInternationally).toBe(false);
      });

      it('should parse "no" as false', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', 'no', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.willShipInternationally).toBe(false);
      });

      it('should parse "false" as false', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', 'false', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.willShipInternationally).toBe(false);
      });

      it('should parse empty value as null', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '1', '', '', '', '', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.willShipInternationally).toBeNull();
      });
    });

    describe('numeric field parsing', () => {
      it('should parse price as float', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '99.99', '1', '', '', '', '', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].price).toBe(99.99);
      });

      it('should parse quantity as integer', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '25', '', '', '', '', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].quantity).toBe(25);
      });

      it('should parse pending quantity as integer', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '25', '', '', '', '', '', '', 'ASIN', '3', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].amazonData.pendingQuantity).toBe(3);
      });

      it('should handle empty price as null', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '', '1', '', '', '', '', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].price).toBeNull();
      });

      it('should handle empty quantity as 0', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', '', '', '', '', '', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].quantity).toBe(0);
      });

      it('should handle invalid price as null', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', 'not-a-number', '1', '', '', '', '', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].price).toBeNull();
      });

      it('should handle invalid quantity as 0', () => {
        const report = createReport([
          ['Item', '', '', 'SKU', '10', 'not-a-number', '', '', '', '', '', '', 'ASIN', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        expect(result.listings[0].quantity).toBe(0);
      });
    });

    describe('row skipping', () => {
      it('should skip rows without SKU and ASIN', () => {
        const report = createReport([
          ['Item', '', '', 'SKU-001', '10', '1', '', '', '', '', '', '', 'ASIN001', '', '', '', 'Active'],
          ['Item No IDs', '', '', '', '10', '1', '', '', '', '', '', '', '', '', '', '', 'Active'],
          ['Item', '', '', 'SKU-002', '20', '2', '', '', '', '', '', '', 'ASIN002', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);

        expect(result.listings).toHaveLength(2);
        expect(result.skippedRows).toBe(1);
        expect(result.listings[0].sellerSku).toBe('SKU-001');
        expect(result.listings[1].sellerSku).toBe('SKU-002');
      });

      it('should skip empty lines', () => {
        const content = createReport([
          ['Item', '', '', 'SKU-001', '10', '1', '', '', '', '', '', '', 'ASIN001', '', '', '', 'Active'],
        ]) + '\n\n\n';

        const result = parseAmazonListingsReport(content);

        expect(result.listings).toHaveLength(1);
        expect(result.skippedRows).toBe(0); // Empty lines are filtered out before counting
      });

      it('should include row with only SKU (no ASIN)', () => {
        const report = createReport([
          ['Item', '', '', 'SKU-001', '10', '1', '', '', '', '', '', '', '', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);

        expect(result.listings).toHaveLength(1);
        expect(result.listings[0].sellerSku).toBe('SKU-001');
        expect(result.listings[0].asin).toBe('');
      });

      it('should include row with only ASIN (no SKU)', () => {
        const report = createReport([
          ['Item', '', '', '', '10', '1', '', '', '', '', '', '', 'ASIN001', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);

        expect(result.listings).toHaveLength(1);
        expect(result.listings[0].sellerSku).toBe('');
        expect(result.listings[0].asin).toBe('ASIN001');
      });
    });

    describe('error handling', () => {
      it('should return error for empty report', () => {
        const result = parseAmazonListingsReport('');

        expect(result.listings).toHaveLength(0);
        expect(result.errors).toContain('Report is empty or has no data rows');
      });

      it('should return error for header-only report', () => {
        const report = 'item-name\tseller-sku\tproduct-id\tquantity';

        const result = parseAmazonListingsReport(report);

        expect(result.listings).toHaveLength(0);
        expect(result.errors).toContain('Report is empty or has no data rows');
      });

      it('should return error for missing required columns', () => {
        const report = 'item-name\tprice\n' +
          'Test Item\t10.00';

        const result = parseAmazonListingsReport(report);

        expect(result.listings).toHaveLength(0);
        expect(result.errors.some((e) => e.includes('seller-sku'))).toBe(true);
        expect(result.errors.some((e) => e.includes('product-id'))).toBe(true);
        expect(result.errors.some((e) => e.includes('quantity'))).toBe(true);
      });

      it('should track total rows correctly', () => {
        const report = createReport([
          ['Item 1', '', '', 'SKU-001', '10', '1', '', '', '', '', '', '', 'ASIN001', '', '', '', 'Active'],
          ['Item 2', '', '', 'SKU-002', '20', '2', '', '', '', '', '', '', 'ASIN002', '', '', '', 'Active'],
          ['Item 3', '', '', 'SKU-003', '30', '3', '', '', '', '', '', '', 'ASIN003', '', '', '', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);

        expect(result.totalRows).toBe(3);
      });
    });

    describe('raw row storage', () => {
      it('should store all column values in rawRow', () => {
        const report = createReport([
          ['Test Item', 'Description', 'L001', 'SKU-001', '10.00', '5', '2024-01-01', 'ASIN', 'Note', '11', 'y', 'n', 'B12345', '0', 'DEFAULT', 'Standard', 'Active'],
        ]);

        const result = parseAmazonListingsReport(report);
        const rawRow = result.listings[0].rawRow;

        expect(rawRow['item-name']).toBe('Test Item');
        expect(rawRow['item-description']).toBe('Description');
        expect(rawRow['listing-id']).toBe('L001');
        expect(rawRow['seller-sku']).toBe('SKU-001');
        expect(rawRow['price']).toBe('10.00');
        expect(rawRow['quantity']).toBe('5');
        expect(rawRow['product-id']).toBe('B12345');
        expect(rawRow['status']).toBe('Active');
      });
    });

    describe('line ending handling', () => {
      it('should handle Unix line endings (LF)', () => {
        const content = 'item-name\tseller-sku\tproduct-id\tquantity\n' +
          'Item 1\tSKU-001\tASIN001\t5\n' +
          'Item 2\tSKU-002\tASIN002\t3';

        const result = parseAmazonListingsReport(content);

        expect(result.listings).toHaveLength(2);
      });

      it('should handle Windows line endings (CRLF)', () => {
        const content = 'item-name\tseller-sku\tproduct-id\tquantity\r\n' +
          'Item 1\tSKU-001\tASIN001\t5\r\n' +
          'Item 2\tSKU-002\tASIN002\t3';

        const result = parseAmazonListingsReport(content);

        expect(result.listings).toHaveLength(2);
      });
    });
  });

  // ===========================================================================
  // getReportColumns
  // ===========================================================================

  describe('getReportColumns', () => {
    it('should extract column names from header', () => {
      const content = 'item-name\tseller-sku\tproduct-id\tquantity\n' +
        'Test Item\tSKU-001\tASIN001\t5';

      const columns = getReportColumns(content);

      expect(columns).toEqual(['item-name', 'seller-sku', 'product-id', 'quantity']);
    });

    it('should return array with empty string for empty content', () => {
      const columns = getReportColumns('');

      // Implementation splits empty string which results in ['']
      expect(columns).toEqual(['']);
    });

    it('should handle single column', () => {
      const content = 'column-name\nvalue';

      const columns = getReportColumns(content);

      expect(columns).toEqual(['column-name']);
    });

    it('should trim whitespace from column names', () => {
      const content = '  item-name  \t  seller-sku  \n' +
        'Test Item\tSKU-001';

      const columns = getReportColumns(content);

      expect(columns).toEqual(['item-name', 'seller-sku']);
    });
  });

  // ===========================================================================
  // getColumnLabel
  // ===========================================================================

  describe('getColumnLabel', () => {
    it('should return human-readable labels for known columns', () => {
      expect(getColumnLabel('item-name')).toBe('Title');
      expect(getColumnLabel('seller-sku')).toBe('SKU');
      expect(getColumnLabel('product-id')).toBe('ASIN');
      expect(getColumnLabel('price')).toBe('Price');
      expect(getColumnLabel('quantity')).toBe('Quantity');
      expect(getColumnLabel('fulfillment-channel')).toBe('Fulfillment');
      expect(getColumnLabel('status')).toBe('Status');
    });

    it('should convert unknown columns to title case', () => {
      expect(getColumnLabel('custom-column')).toBe('Custom Column');
      expect(getColumnLabel('my-special-field')).toBe('My Special Field');
    });

    it('should handle single word columns', () => {
      expect(getColumnLabel('status')).toBe('Status');
    });

    it('should be case-insensitive', () => {
      expect(getColumnLabel('ITEM-NAME')).toBe('Title');
      expect(getColumnLabel('Item-Name')).toBe('Title');
    });
  });
});
