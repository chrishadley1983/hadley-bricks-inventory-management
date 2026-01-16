import { describe, it, expect } from 'vitest';
import {
  EBAY_CATEGORIES,
  EBAY_FILTERS,
  buildEbaySearchUrl,
  buildEbayItemUrl,
  buildEbaySoldSearchUrl,
} from '../ebay-url';

describe('eBay URL Utilities', () => {
  // ============================================
  // Constants
  // ============================================

  describe('EBAY_CATEGORIES', () => {
    it('should have correct LEGO Complete Sets category ID', () => {
      expect(EBAY_CATEGORIES.LEGO_COMPLETE_SETS).toBe('19006');
    });

    it('should have correct LEGO Minifigures category ID', () => {
      expect(EBAY_CATEGORIES.LEGO_MINIFIGURES).toBe('19001');
    });

    it('should have correct LEGO Bricks & Pieces category ID', () => {
      expect(EBAY_CATEGORIES.LEGO_BRICKS_PIECES).toBe('19003');
    });

    it('should have correct LEGO Instructions category ID', () => {
      expect(EBAY_CATEGORIES.LEGO_INSTRUCTIONS).toBe('19007');
    });
  });

  describe('EBAY_FILTERS', () => {
    it('should have Buy It Now filter', () => {
      expect(EBAY_FILTERS.BUY_IT_NOW).toBe('LH_BIN=1');
    });

    it('should have New Condition filter', () => {
      expect(EBAY_FILTERS.NEW_CONDITION).toBe('LH_ItemCondition=1000');
    });

    it('should have UK Only filter', () => {
      expect(EBAY_FILTERS.UK_ONLY).toBe('LH_PrefLoc=1');
    });
  });

  // ============================================
  // buildEbaySearchUrl
  // ============================================

  describe('buildEbaySearchUrl', () => {
    it('should build eBay UK search URL', () => {
      const url = buildEbaySearchUrl('75192');

      expect(url).toContain('ebay.co.uk');
    });

    it('should include LEGO Complete Sets category (19006)', () => {
      const url = buildEbaySearchUrl('75192');

      expect(url).toContain('/19006/');
    });

    it('should include "LEGO" prefix in search query', () => {
      const url = buildEbaySearchUrl('75192');

      expect(url).toContain('LEGO%2075192');
    });

    it('should strip -1 suffix from set number', () => {
      const url = buildEbaySearchUrl('40585-1');

      expect(url).toContain('LEGO%2040585');
      expect(url).not.toContain('-1');
    });

    it('should strip any -N suffix from set number', () => {
      const url = buildEbaySearchUrl('10179-2');

      expect(url).toContain('LEGO%2010179');
      expect(url).not.toContain('-2');
    });

    it('should include Buy It Now filter', () => {
      const url = buildEbaySearchUrl('75192');

      expect(url).toContain('LH_BIN=1');
    });

    it('should include New condition filter', () => {
      const url = buildEbaySearchUrl('75192');

      expect(url).toContain('LH_ItemCondition=1000');
    });

    it('should include UK only filter', () => {
      const url = buildEbaySearchUrl('75192');

      expect(url).toContain('LH_PrefLoc=1');
    });

    it('should handle 4-digit set numbers', () => {
      const url = buildEbaySearchUrl('7191');

      expect(url).toContain('LEGO%207191');
    });

    it('should handle 6-digit set numbers', () => {
      const url = buildEbaySearchUrl('910007');

      expect(url).toContain('LEGO%20910007');
    });
  });

  // ============================================
  // buildEbayItemUrl
  // ============================================

  describe('buildEbayItemUrl', () => {
    it('should build direct item URL from numeric ID', () => {
      const url = buildEbayItemUrl('205988726767');

      expect(url).toBe('https://www.ebay.co.uk/itm/205988726767');
    });

    it('should extract numeric ID from v1|...|0 format', () => {
      const url = buildEbayItemUrl('v1|205988726767|0');

      expect(url).toBe('https://www.ebay.co.uk/itm/205988726767');
    });

    it('should handle different versioned formats', () => {
      const url = buildEbayItemUrl('v2|123456789012|0');

      expect(url).toBe('https://www.ebay.co.uk/itm/123456789012');
    });

    it('should strip non-numeric characters if not in versioned format', () => {
      const url = buildEbayItemUrl('item-205988726767-end');

      expect(url).toBe('https://www.ebay.co.uk/itm/205988726767');
    });

    it('should handle short item IDs', () => {
      const url = buildEbayItemUrl('123456');

      expect(url).toBe('https://www.ebay.co.uk/itm/123456');
    });
  });

  // ============================================
  // buildEbaySoldSearchUrl
  // ============================================

  describe('buildEbaySoldSearchUrl', () => {
    it('should build eBay UK sold items URL', () => {
      const url = buildEbaySoldSearchUrl('75192');

      expect(url).toContain('ebay.co.uk');
    });

    it('should include LEGO Complete Sets category', () => {
      const url = buildEbaySoldSearchUrl('75192');

      expect(url).toContain('/19006/');
    });

    it('should include "LEGO" prefix in search query', () => {
      const url = buildEbaySoldSearchUrl('75192');

      expect(url).toContain('LEGO%2075192');
    });

    it('should strip -1 suffix from set number', () => {
      const url = buildEbaySoldSearchUrl('40585-1');

      expect(url).toContain('LEGO%2040585');
      expect(url).not.toContain('-1');
    });

    it('should include completed listings filter', () => {
      const url = buildEbaySoldSearchUrl('75192');

      expect(url).toContain('LH_Complete=1');
    });

    it('should include sold items filter', () => {
      const url = buildEbaySoldSearchUrl('75192');

      expect(url).toContain('LH_Sold=1');
    });

    it('should include New condition filter', () => {
      const url = buildEbaySoldSearchUrl('75192');

      expect(url).toContain('LH_ItemCondition=1000');
    });

    it('should include UK only filter', () => {
      const url = buildEbaySoldSearchUrl('75192');

      expect(url).toContain('LH_PrefLoc=1');
    });

    it('should NOT include Buy It Now filter (sold items can be from auctions)', () => {
      const url = buildEbaySoldSearchUrl('75192');

      // Sold items shouldn't be limited to BIN since auctions are valid sold items
      expect(url).not.toContain('LH_BIN=1');
    });
  });
});
