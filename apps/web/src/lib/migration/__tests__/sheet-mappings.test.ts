import { describe, it, expect } from 'vitest';
import {
  parseUKDate,
  parseCurrency,
  parsePercentage,
  normalizeStatus,
  normalizeCondition,
  transformRow,
  newKitInventoryMapping,
  usedKitInventoryMapping,
  addConditionFromSheet,
} from '../sheet-mappings';

describe('parseUKDate', () => {
  it('parses DD/MM/YYYY format', () => {
    expect(parseUKDate('15/01/2024')).toBe('2024-01-15');
    expect(parseUKDate('01/12/2023')).toBe('2023-12-01');
    expect(parseUKDate('5/3/2024')).toBe('2024-03-05');
  });

  it('parses DD-MMM-YY format', () => {
    expect(parseUKDate('15-Jan-24')).toBe('2024-01-15');
    expect(parseUKDate('31-Dec-23')).toBe('2023-12-31');
    expect(parseUKDate('1-Mar-25')).toBe('2025-03-01');
  });

  it('returns null for empty values', () => {
    expect(parseUKDate('')).toBeNull();
    expect(parseUKDate('  ')).toBeNull();
  });

  it('returns null for invalid formats', () => {
    expect(parseUKDate('invalid')).toBeNull();
    expect(parseUKDate('2024-01-15')).toBeNull(); // ISO format not handled
  });
});

describe('parseCurrency', () => {
  it('parses GBP currency strings', () => {
    expect(parseCurrency('£1,234.56')).toBe(1234.56);
    expect(parseCurrency('£50.00')).toBe(50);
    expect(parseCurrency('£0')).toBe(0);
  });

  it('parses plain numbers', () => {
    expect(parseCurrency('100.50')).toBe(100.5);
    expect(parseCurrency('50')).toBe(50);
  });

  it('parses USD currency strings', () => {
    expect(parseCurrency('$100.00')).toBe(100);
  });

  it('handles commas as thousand separators', () => {
    expect(parseCurrency('1,000')).toBe(1000);
    expect(parseCurrency('10,000,000')).toBe(10000000);
  });

  it('returns null for empty values', () => {
    expect(parseCurrency('')).toBeNull();
    expect(parseCurrency('  ')).toBeNull();
  });

  it('returns null for invalid numbers', () => {
    expect(parseCurrency('invalid')).toBeNull();
  });
});

describe('parsePercentage', () => {
  it('parses percentage strings', () => {
    expect(parsePercentage('50%')).toBe(0.5);
    expect(parsePercentage('100%')).toBe(1);
    expect(parsePercentage('25.5%')).toBe(0.255);
  });

  it('returns null for empty values', () => {
    expect(parsePercentage('')).toBeNull();
    expect(parsePercentage('  ')).toBeNull();
  });
});

describe('normalizeStatus', () => {
  it('normalizes uppercase status values', () => {
    expect(normalizeStatus('SOLD')).toBe('SOLD');
    expect(normalizeStatus('LISTED')).toBe('LISTED');
    expect(normalizeStatus('BACKLOG')).toBe('BACKLOG');
    expect(normalizeStatus('NOT YET RECEIVED')).toBe('NOT YET RECEIVED');
  });

  it('normalizes lowercase status values', () => {
    expect(normalizeStatus('sold')).toBe('SOLD');
    expect(normalizeStatus('listed')).toBe('LISTED');
    expect(normalizeStatus('backlog')).toBe('BACKLOG');
  });

  it('handles legacy IN STOCK mapping to BACKLOG', () => {
    expect(normalizeStatus('IN STOCK')).toBe('BACKLOG');
    expect(normalizeStatus('in stock')).toBe('BACKLOG');
    expect(normalizeStatus('stock')).toBe('BACKLOG');
    expect(normalizeStatus('pending')).toBe('NOT YET RECEIVED');
  });

  it('defaults to BACKLOG for unknown values', () => {
    expect(normalizeStatus('unknown')).toBe('BACKLOG');
    expect(normalizeStatus('')).toBe('BACKLOG');
  });
});

describe('normalizeCondition', () => {
  it('normalizes to New', () => {
    expect(normalizeCondition('New')).toBe('New');
    expect(normalizeCondition('new')).toBe('New');
    expect(normalizeCondition('NEW')).toBe('New');
    expect(normalizeCondition('Brand New')).toBe('New');
  });

  it('normalizes to Used', () => {
    expect(normalizeCondition('Used')).toBe('Used');
    expect(normalizeCondition('used')).toBe('Used');
    expect(normalizeCondition('Pre-owned')).toBe('Used');
    expect(normalizeCondition('')).toBe('Used');
  });
});

describe('transformRow', () => {
  it('transforms a new kit inventory row', () => {
    const row = {
      ID: 'N1',
      Item: 'Millennium Falcon',
      'Set Number': '75192',
      Source: 'LEGO Store',
      'Purchase Date': '15/01/2024',
      'Total Cost': '£650.00',
      Status: 'IN STOCK',
      'Storage Location': 'Shelf A',
    };

    const result = transformRow(row, newKitInventoryMapping);

    expect(result.sku).toBe('N1');
    expect(result.item_name).toBe('Millennium Falcon');
    expect(result.set_number).toBe('75192');
    expect(result.source).toBe('LEGO Store');
    expect(result.purchase_date).toBe('2024-01-15');
    expect(result.cost).toBe(650);
    expect(result.status).toBe('BACKLOG'); // Legacy 'IN STOCK' maps to 'BACKLOG'
    expect(result.storage_location).toBe('Shelf A');
  });

  it('clears storage location when SOLD', () => {
    const row = {
      ID: 'N2',
      'Set Number': '12345',
      'Storage Location': 'SOLD',
    };

    const result = transformRow(row, newKitInventoryMapping);
    expect(result.storage_location).toBeNull();
  });

  it('handles missing optional fields', () => {
    const row = {
      ID: 'N3',
      'Set Number': '12345',
    };

    const result = transformRow(row, newKitInventoryMapping);
    expect(result.sku).toBe('N3');
    expect(result.set_number).toBe('12345');
    expect(result.item_name).toBeUndefined();
    expect(result.cost).toBeUndefined();
  });

  it('transforms a used kit inventory row', () => {
    const row = {
      ID: 'U1',
      Item: 'Fire Temple',
      'Set Number': '2507',
      Source: 'Gumtree',
      'Purchase Date': '28/12/2023',
      Cost: '25',
      Status: 'SOLD',
      'Listing Date': '12/01/2024',
      'Storage Location': 'SOLD',
      SKU: 'U1',
    };

    const result = transformRow(row, usedKitInventoryMapping);

    expect(result.sku).toBe('U1');
    expect(result.item_name).toBe('Fire Temple');
    expect(result.set_number).toBe('2507');
    expect(result.source).toBe('Gumtree');
    expect(result.purchase_date).toBe('2023-12-28');
    expect(result.cost).toBe(25);
    expect(result.status).toBe('SOLD');
  });
});

describe('addConditionFromSheet', () => {
  it('adds New condition for New Kit Inventory', () => {
    const data = { set_number: '12345' };
    const result = addConditionFromSheet(data, 'Lego New Kit Inventory');
    expect(result.condition).toBe('New');
  });

  it('adds Used condition for Used Kit Inventory', () => {
    const data = { set_number: '12345' };
    const result = addConditionFromSheet(data, 'Lego Used Kit Inventory');
    expect(result.condition).toBe('Used');
  });

  it('does not add condition for other sheets', () => {
    const data = { set_number: '12345' };
    const result = addConditionFromSheet(data, 'Purchases');
    expect(result.condition).toBeUndefined();
  });
});
