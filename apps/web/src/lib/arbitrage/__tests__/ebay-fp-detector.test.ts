import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EbayFpDetectorService } from '../ebay-fp-detector.service';
import type { EbayListing } from '../types';
import { SIGNAL_WEIGHTS, DEFAULT_THRESHOLD } from '../ebay-fp-detector.types';

/**
 * Helper: create a minimal EbayListing for testing
 */
function makeListing(overrides: Partial<EbayListing> = {}): EbayListing {
  return {
    itemId: 'test-item-001',
    title: 'LEGO Star Wars 75192 Millennium Falcon New Sealed',
    price: 50,
    currency: 'GBP',
    shipping: 0,
    totalPrice: 50,
    seller: 'test-seller',
    sellerFeedback: 99.5,
    url: 'https://www.ebay.co.uk/itm/test',
    ...overrides,
  };
}

/**
 * Helper: create valid set numbers set for testing
 */
function makeValidSetNumbers(...extra: string[]): Set<string> {
  // A baseline set of common LEGO set numbers
  return new Set([
    '75192', '10281', '42115', '60198', '21327', '10276',
    '75309', '10300', '71043', '31058', '60389', '40585',
    ...extra,
  ]);
}

// We only need scoreListing for unit tests - no Supabase required
const createService = () => {
  const mockSupabase = { from: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new EbayFpDetectorService(mockSupabase as any);
};

describe('EbayFpDetectorService', () => {
  let service: EbayFpDetectorService;
  let validSets: Set<string>;

  beforeEach(() => {
    service = createService();
    validSets = makeValidSetNumbers();
  });

  // ============================================
  // Signal weights sanity check
  // ============================================

  describe('signal weights', () => {
    it('should have 22 signals defined', () => {
      expect(Object.keys(SIGNAL_WEIGHTS)).toHaveLength(22);
    });

    it('should have a default threshold of 50', () => {
      expect(DEFAULT_THRESHOLD).toBe(50);
    });
  });

  // ============================================
  // Valid listings - MUST NOT be excluded
  // ============================================

  describe('valid listings (must NOT be excluded)', () => {
    it('should not flag a standard sealed set listing', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars 75192 Millennium Falcon - Brand New Sealed',
        totalPrice: 550,
      });
      const { score } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should not flag a listing with "set" in title', () => {
      const listing = makeListing({
        title: 'LEGO City Police Station Set 60316 New',
        totalPrice: 35,
      });
      const { score } = service.scoreListing(listing, '60316', 'Police Station', 44.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should not flag "LEGO Creator 3 in 1 31058"', () => {
      const listing = makeListing({
        title: 'LEGO Creator 3 in 1 Mighty Dinosaurs 31058 New Sealed',
        totalPrice: 10,
      });
      const { score } = service.scoreListing(listing, '31058', 'Mighty Dinosaurs', 12.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should not flag "LEGO 4+ City Police Station"', () => {
      const listing = makeListing({
        title: 'LEGO 4+ City Custom Car Garage 60389 New',
        totalPrice: 25,
      });
      // "custom" is in the set name - should NOT trigger CUSTOM_MOC
      // because "custom" alone doesn't match "custom build" or "custom moc"
      const { score } = service.scoreListing(listing, '60389', 'Custom Car Garage', 29.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should not flag a legitimate LEGO set with "display" in the name', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars 75352 Emperor Throne Room Diorama Display New',
        totalPrice: 70,
      });
      // "display" alone doesn't match DISPLAY_ACCESSORY - it needs "display stand", "display case" etc.
      const { score } = service.scoreListing(listing, '75352', "Emperor's Throne Room Diorama", 89.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should not flag a listing with "Collectors Edition"', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars 75192 Millennium Falcon Ultimate Collectors Edition',
        totalPrice: 600,
      });
      const { score } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should not flag a listing with "Retired" in title', () => {
      const listing = makeListing({
        title: 'LEGO 10281 Bonsai Tree - Retired Set - New Sealed',
        totalPrice: 55,
      });
      const { score } = service.scoreListing(listing, '10281', 'Bonsai Tree', 49.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should not flag a listing that says "Free magazine included"', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Millennium Falcon New Sealed',
        totalPrice: 580,
      });
      // "magazine" not in title - this tests the base case
      const { score } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should not flag a set with numeric name parts like "Lamborghini Sián FKP 37"', () => {
      const listing = makeListing({
        title: 'LEGO Technic 42115 Lamborghini Sián FKP 37 New Sealed',
        totalPrice: 300,
      });
      const { score } = service.scoreListing(listing, '42115', 'Lamborghini Sián FKP 37', 349.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should not flag "LEGO Architecture Statue of Liberty 21042"', () => {
      const listing = makeListing({
        title: 'LEGO Architecture Statue of Liberty 21042 Brand New',
        totalPrice: 80,
      });
      const { score } = service.scoreListing(listing, '21042', 'Statue of Liberty', 99.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should not flag a correctly priced set without set number in title', () => {
      const listing = makeListing({
        title: 'LEGO Ideas Typewriter Brand New In Sealed Box',
        totalPrice: 180,
      });
      // Missing set number = 15 pts only, below threshold
      const { score } = service.scoreListing(listing, '21327', 'Typewriter', 199.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });
  });

  // ============================================
  // Signal 15: LED_LIGHT_KIT (30 pts)
  // ============================================

  describe('signal 15: LED_LIGHT_KIT', () => {
    it('should detect "LED Light Kit for LEGO 75192"', () => {
      const listing = makeListing({
        title: 'LED Light Kit for LEGO 75192 Star Wars Millennium Falcon USB Powered',
        totalPrice: 25,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'LED_LIGHT_KIT')).toBe(true);
    });

    it('should detect "Lighting Kit Set for LEGO"', () => {
      const listing = makeListing({
        title: 'LEGO 10281 Bonsai Tree Lighting Kit Set',
        totalPrice: 18,
      });
      const { signals } = service.scoreListing(listing, '10281', 'Bonsai Tree', 49.99, validSets);
      expect(signals.some((s) => s.signal === 'LED_LIGHT_KIT')).toBe(true);
    });

    it('should detect "LED Kit for LEGO"', () => {
      const listing = makeListing({
        title: 'LED Kit LEGO Technic 42115 Lamborghini',
        totalPrice: 20,
      });
      const { signals } = service.scoreListing(listing, '42115', 'Lamborghini Sián FKP 37', 349.99, validSets);
      expect(signals.some((s) => s.signal === 'LED_LIGHT_KIT')).toBe(true);
    });

    it('should detect "Light Kit" standalone', () => {
      const listing = makeListing({
        title: 'Light Kit LEGO 75192 Millennium Falcon',
        totalPrice: 30,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'LED_LIGHT_KIT')).toBe(true);
    });

    it('should detect "Lighting Set for LEGO"', () => {
      const listing = makeListing({
        title: 'LEGO 10281 Bonsai Tree Lighting Set USB',
        totalPrice: 15,
      });
      const { signals } = service.scoreListing(listing, '10281', 'Bonsai Tree', 49.99, validSets);
      expect(signals.some((s) => s.signal === 'LED_LIGHT_KIT')).toBe(true);
    });

    it('should NOT detect "light" alone in a normal listing', () => {
      const listing = makeListing({
        title: 'LEGO City 60198 Freight Train Light Up New Sealed',
        totalPrice: 120,
      });
      const { signals } = service.scoreListing(listing, '60198', 'Freight Train', 149.99, validSets);
      expect(signals.some((s) => s.signal === 'LED_LIGHT_KIT')).toBe(false);
    });
  });

  // ============================================
  // Signal 16: DISPLAY_ACCESSORY (25 pts)
  // ============================================

  describe('signal 16: DISPLAY_ACCESSORY', () => {
    it('should detect "Display Stand for LEGO"', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Display Stand Premium Oak Finish',
        totalPrice: 45,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'DISPLAY_ACCESSORY')).toBe(true);
    });

    it('should detect "Acrylic Display Case"', () => {
      const listing = makeListing({
        title: 'Acrylic Display Case for LEGO 10281 Bonsai Tree',
        totalPrice: 35,
      });
      const { signals } = service.scoreListing(listing, '10281', 'Bonsai Tree', 49.99, validSets);
      expect(signals.some((s) => s.signal === 'DISPLAY_ACCESSORY')).toBe(true);
    });

    it('should detect "Display Frame"', () => {
      const listing = makeListing({
        title: 'LEGO Minifigure Display Frame 75192 Theme',
        totalPrice: 15,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'DISPLAY_ACCESSORY')).toBe(true);
    });

    it('should detect "Wall Mount"', () => {
      const listing = makeListing({
        title: 'Wall Mount Bracket for LEGO Star Wars 75192',
        totalPrice: 20,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'DISPLAY_ACCESSORY')).toBe(true);
    });

    it('should detect "Name Plate"', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Millennium Falcon Name Plate Engraved',
        totalPrice: 12,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'DISPLAY_ACCESSORY')).toBe(true);
    });

    it('should detect "Dust Cover"', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Dust Cover Clear Protective',
        totalPrice: 25,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'DISPLAY_ACCESSORY')).toBe(true);
    });

    it('should NOT detect "display" alone', () => {
      const listing = makeListing({
        title: 'LEGO 75352 Display Diorama Emperor Throne Room',
        totalPrice: 70,
      });
      const { signals } = service.scoreListing(listing, '75352', "Emperor's Throne Room Diorama", 89.99, validSets);
      expect(signals.some((s) => s.signal === 'DISPLAY_ACCESSORY')).toBe(false);
    });

    it('should NOT detect "display model" (legitimate LEGO terminology)', () => {
      const listing = makeListing({
        title: 'LEGO 10281 Bonsai Tree Display Model New Sealed',
        totalPrice: 45,
      });
      const { signals } = service.scoreListing(listing, '10281', 'Bonsai Tree', 49.99, validSets);
      expect(signals.some((s) => s.signal === 'DISPLAY_ACCESSORY')).toBe(false);
    });
  });

  // ============================================
  // Signal 17: THIRD_PARTY_PRODUCT (30 pts)
  // ============================================

  describe('signal 17: THIRD_PARTY_PRODUCT', () => {
    it('should detect "for LEGO"', () => {
      const listing = makeListing({
        title: 'LED Light Kit for LEGO 75192 Millennium Falcon',
        totalPrice: 25,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'THIRD_PARTY_PRODUCT')).toBe(true);
    });

    it('should detect "Compatible With"', () => {
      const listing = makeListing({
        title: 'Compatible With LEGO 75192 Building Blocks Set',
        totalPrice: 35,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'THIRD_PARTY_PRODUCT')).toBe(true);
    });

    it('should detect "Compatible For"', () => {
      const listing = makeListing({
        title: 'Motor Compatible For LEGO Technic 42115',
        totalPrice: 15,
      });
      const { signals } = service.scoreListing(listing, '42115', 'Lamborghini Sián FKP 37', 349.99, validSets);
      expect(signals.some((s) => s.signal === 'THIRD_PARTY_PRODUCT')).toBe(true);
    });

    it('should detect "Fits LEGO"', () => {
      const listing = makeListing({
        title: 'Battery Box Motor Fits LEGO Technic 42115',
        totalPrice: 10,
      });
      const { signals } = service.scoreListing(listing, '42115', 'Lamborghini Sián FKP 37', 349.99, validSets);
      expect(signals.some((s) => s.signal === 'THIRD_PARTY_PRODUCT')).toBe(true);
    });

    it('should detect "Replacement Sticker"', () => {
      const listing = makeListing({
        title: 'Replacement Sticker Sheet LEGO 75192 Millennium Falcon',
        totalPrice: 5,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'THIRD_PARTY_PRODUCT')).toBe(true);
    });

    it('should NOT detect "LEGO" at beginning of standard listing', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars 75192 Millennium Falcon New Sealed',
        totalPrice: 550,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'THIRD_PARTY_PRODUCT')).toBe(false);
    });
  });

  // ============================================
  // Signal 18: BUNDLE_LOT (25 pts)
  // ============================================

  describe('signal 18: BUNDLE_LOT', () => {
    it('should detect "Job Lot"', () => {
      const listing = makeListing({
        title: 'LEGO Job Lot 5kg Mixed Star Wars City Bricks',
        totalPrice: 40,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'BUNDLE_LOT')).toBe(true);
    });

    it('should detect "Joblot" (no space)', () => {
      const listing = makeListing({
        title: 'LEGO Joblot Mixed Minifigures Sets Bricks',
        totalPrice: 30,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'BUNDLE_LOT')).toBe(true);
    });

    it('should detect "Bulk Lot"', () => {
      const listing = makeListing({
        title: 'LEGO Bulk Lot Mixed Sets & Pieces 3kg',
        totalPrice: 25,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'BUNDLE_LOT')).toBe(true);
    });

    it('should detect "Mixed Lot"', () => {
      const listing = makeListing({
        title: 'LEGO Mixed Lot Star Wars Sets and Minifigures',
        totalPrice: 50,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'BUNDLE_LOT')).toBe(true);
    });

    it('should NOT detect "bundle" alone (legitimate usage)', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Millennium Falcon + Gift Bundle',
        totalPrice: 600,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'BUNDLE_LOT')).toBe(false);
    });

    it('should NOT detect "lot" alone (could be "a lot of fun")', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Millennium Falcon New Sealed - A Lot of Pieces!',
        totalPrice: 550,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'BUNDLE_LOT')).toBe(false);
    });
  });

  // ============================================
  // Signal 19: CUSTOM_MOC (30 pts)
  // ============================================

  describe('signal 19: CUSTOM_MOC', () => {
    it('should detect "MOC" (My Own Creation)', () => {
      const listing = makeListing({
        title: 'LEGO MOC Star Wars Diorama Custom Build 75192',
        totalPrice: 80,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'CUSTOM_MOC')).toBe(true);
    });

    it('should detect "Custom Build"', () => {
      const listing = makeListing({
        title: 'LEGO Custom Build Medieval Castle Based on 10305',
        totalPrice: 100,
      });
      const { signals } = service.scoreListing(listing, '10305', 'Lion Knights Castle', 349.99, validSets);
      expect(signals.some((s) => s.signal === 'CUSTOM_MOC')).toBe(true);
    });

    it('should detect "Custom MOC"', () => {
      const listing = makeListing({
        title: 'Custom MOC LEGO Star Wars Scene',
        totalPrice: 60,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'CUSTOM_MOC')).toBe(true);
    });

    it('should NOT detect "custom" in legitimate set name', () => {
      const listing = makeListing({
        title: 'LEGO 4+ City Custom Car Garage 60389 New',
        totalPrice: 25,
      });
      // "Custom Car" should NOT match "custom build" or "custom moc"
      const { signals } = service.scoreListing(listing, '60389', 'Custom Car Garage', 29.99, validSets);
      expect(signals.some((s) => s.signal === 'CUSTOM_MOC')).toBe(false);
    });

    it('should NOT detect "custom" followed by non-build words', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Millennium Falcon Custom Delivery Fast Shipping',
        totalPrice: 580,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'CUSTOM_MOC')).toBe(false);
    });
  });

  // ============================================
  // Signal 20: MULTI_QUANTITY (20 pts)
  // ============================================

  describe('signal 20: MULTI_QUANTITY', () => {
    it('should detect "x2" pattern', () => {
      const listing = makeListing({
        title: 'LEGO 10281 Bonsai Tree x2',
        totalPrice: 90,
      });
      const { signals } = service.scoreListing(listing, '10281', 'Bonsai Tree', 49.99, validSets);
      expect(signals.some((s) => s.signal === 'MULTI_QUANTITY')).toBe(true);
    });

    it('should detect "x 3" pattern (with space)', () => {
      const listing = makeListing({
        title: 'LEGO 10281 Bonsai Tree x 3 Sets',
        totalPrice: 130,
      });
      const { signals } = service.scoreListing(listing, '10281', 'Bonsai Tree', 49.99, validSets);
      expect(signals.some((s) => s.signal === 'MULTI_QUANTITY')).toBe(true);
    });

    it('should detect "2x" prefix pattern', () => {
      const listing = makeListing({
        title: '2x LEGO Star Wars 75192 Millennium Falcon',
        totalPrice: 1100,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'MULTI_QUANTITY')).toBe(true);
    });

    it('should NOT detect set numbers like "31058"', () => {
      const listing = makeListing({
        title: 'LEGO Creator 3 in 1 Mighty Dinosaurs 31058 New Sealed',
        totalPrice: 10,
      });
      const { signals } = service.scoreListing(listing, '31058', 'Mighty Dinosaurs', 12.99, validSets);
      expect(signals.some((s) => s.signal === 'MULTI_QUANTITY')).toBe(false);
    });

    it('should NOT detect "x1" (single quantity)', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Millennium Falcon x1 New Sealed',
        totalPrice: 550,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'MULTI_QUANTITY')).toBe(false);
    });
  });

  // ============================================
  // Signal 21: BOOK_MAGAZINE (25 pts)
  // ============================================

  describe('signal 21: BOOK_MAGAZINE', () => {
    it('should detect "Annual"', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars Annual 2024 with Mini Figure',
        totalPrice: 8,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'BOOK_MAGAZINE')).toBe(true);
    });

    it('should detect "Activity Book"', () => {
      const listing = makeListing({
        title: 'LEGO City Activity Book with Mini Set 60198',
        totalPrice: 6,
      });
      const { signals } = service.scoreListing(listing, '60198', 'Freight Train', 149.99, validSets);
      expect(signals.some((s) => s.signal === 'BOOK_MAGAZINE')).toBe(true);
    });

    it('should detect "Magazine"', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars Magazine Issue 42 with 75192 Mini Build',
        totalPrice: 5,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'BOOK_MAGAZINE')).toBe(true);
    });

    it('should detect "Encyclopedia"', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars Encyclopedia Updated Edition 2024',
        totalPrice: 15,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'BOOK_MAGAZINE')).toBe(true);
    });

    it('should detect "Ultimate Guide"', () => {
      const listing = makeListing({
        title: 'LEGO Ultimate Guide to Building 2024 Edition',
        totalPrice: 12,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'BOOK_MAGAZINE')).toBe(true);
    });

    it('should NOT flag a set that happens to have educational theme', () => {
      const listing = makeListing({
        title: 'LEGO Ideas 21327 Typewriter New Sealed',
        totalPrice: 180,
      });
      const { signals } = service.scoreListing(listing, '21327', 'Typewriter', 199.99, validSets);
      expect(signals.some((s) => s.signal === 'BOOK_MAGAZINE')).toBe(false);
    });
  });

  // ============================================
  // Signal 22: STICKER_POSTER (25 pts)
  // ============================================

  describe('signal 22: STICKER_POSTER', () => {
    it('should detect "Sticker Sheet" for LEGO set', () => {
      const listing = makeListing({
        title: 'LEGO Technic 42146 Sticker Sheet',
        totalPrice: 9.14,
      });
      const { signals } = service.scoreListing(listing, '42146', 'Liebherr Crawler Crane LR 13000', 599.99, validSets);
      expect(signals.some((s) => s.signal === 'STICKER_POSTER')).toBe(true);
    });

    it('should detect "Decal Sheet"', () => {
      const listing = makeListing({
        title: 'Decal Sheet LEGO Star Wars 75192',
        totalPrice: 5,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'STICKER_POSTER')).toBe(true);
    });

    it('should detect "Poster" standalone', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars 10225 R2-D2 Poster Large',
        totalPrice: 11.36,
      });
      const { signals } = service.scoreListing(listing, '10225', 'R2-D2', 227.99, validSets);
      expect(signals.some((s) => s.signal === 'STICKER_POSTER')).toBe(true);
    });

    it('should detect "Art Print"', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars Art Print Millennium Falcon 75192',
        totalPrice: 15,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'STICKER_POSTER')).toBe(true);
    });

    it('should detect "Wall Sticker"', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars Wall Sticker Bedroom Decor 75192',
        totalPrice: 8,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'STICKER_POSTER')).toBe(true);
    });

    it('should detect "Vinyl Sticker"', () => {
      const listing = makeListing({
        title: 'Vinyl Sticker LEGO Star Wars 75192 Custom',
        totalPrice: 4,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'STICKER_POSTER')).toBe(true);
    });

    it('should detect "Sticker Set"', () => {
      const listing = makeListing({
        title: 'LEGO 75280 Sticker Set Replacement',
        totalPrice: 3.08,
      });
      const { signals } = service.scoreListing(listing, '75280', '501st Legion Clone Troopers', 99.99, validSets);
      expect(signals.some((s) => s.signal === 'STICKER_POSTER')).toBe(true);
    });

    it('should NOT detect "sticker" alone (could be in set description)', () => {
      const listing = makeListing({
        title: 'LEGO Technic 42146 Liebherr Crane New Sealed with Sticker',
        totalPrice: 400,
      });
      const { signals } = service.scoreListing(listing, '42146', 'Liebherr Crawler Crane LR 13000', 599.99, validSets);
      expect(signals.some((s) => s.signal === 'STICKER_POSTER')).toBe(false);
    });

    it('should NOT detect "post" in "posted" or "postage"', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Millennium Falcon New Sealed Free Postage',
        totalPrice: 550,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'STICKER_POSTER')).toBe(false);
    });

    it('should exclude sticker sheet with VERY_LOW_COG (combined > 50)', () => {
      const listing = makeListing({
        title: 'LEGO Technic 42146 Sticker Sheet',
        totalPrice: 9.14,
      });
      const { score } = service.scoreListing(listing, '42146', 'Liebherr Crawler Crane LR 13000', 599.99, validSets);
      // VERY_LOW_COG (35) + STICKER_POSTER (25) + PRICE_ANOMALY (20) = 80
      expect(score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });

    it('should exclude poster at £11+ with VERY_LOW_COG (combined > 50)', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars 10225 R2-D2 Poster',
        totalPrice: 11.36,
      });
      const { score } = service.scoreListing(listing, '10225', 'R2-D2', 227.99, validSets);
      // VERY_LOW_COG (35) + STICKER_POSTER (25) = 60
      expect(score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });
  });

  // ============================================
  // Strengthened INCOMPLETE_INDICATORS
  // ============================================

  describe('strengthened INCOMPLETE_INDICATORS', () => {
    it('should detect "ex display" (space)', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Millennium Falcon Ex Display',
        totalPrice: 450,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'INCOMPLETE_INDICATORS')).toBe(true);
    });

    it('should detect "ex-display" (hyphen)', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Millennium Falcon Ex-Display Model',
        totalPrice: 400,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'INCOMPLETE_INDICATORS')).toBe(true);
    });

    it('should detect "shop display"', () => {
      const listing = makeListing({
        title: 'LEGO 10281 Bonsai Tree Shop Display Opened',
        totalPrice: 30,
      });
      const { signals } = service.scoreListing(listing, '10281', 'Bonsai Tree', 49.99, validSets);
      expect(signals.some((s) => s.signal === 'INCOMPLETE_INDICATORS')).toBe(true);
    });

    it('should detect "unsealed"', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Millennium Falcon Unsealed But Complete',
        totalPrice: 500,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'INCOMPLETE_INDICATORS')).toBe(true);
    });

    it('should detect "open box"', () => {
      const listing = makeListing({
        title: 'LEGO 10281 Bonsai Tree Open Box Complete',
        totalPrice: 35,
      });
      const { signals } = service.scoreListing(listing, '10281', 'Bonsai Tree', 49.99, validSets);
      expect(signals.some((s) => s.signal === 'INCOMPLETE_INDICATORS')).toBe(true);
    });

    it('should detect "box only"', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Box Only No Set Included',
        totalPrice: 20,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'INCOMPLETE_INDICATORS')).toBe(true);
    });

    it('should still detect original patterns (e.g., "damaged")', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Millennium Falcon Damaged Box',
        totalPrice: 480,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'INCOMPLETE_INDICATORS')).toBe(true);
    });
  });

  // ============================================
  // Compound signal tests
  // ============================================

  describe('compound signals (threshold behavior)', () => {
    it('should flag LED light kit + THIRD_PARTY = 60 pts (above threshold)', () => {
      const listing = makeListing({
        title: 'LED Light Kit for LEGO 75192 Millennium Falcon USB',
        totalPrice: 25,
      });
      const { score, signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'LED_LIGHT_KIT')).toBe(true);
      expect(signals.some((s) => s.signal === 'THIRD_PARTY_PRODUCT')).toBe(true);
      expect(score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });

    it('should flag Display Case + THIRD_PARTY = 55 pts (above threshold)', () => {
      const listing = makeListing({
        title: 'Acrylic Display Case for LEGO 10281 Bonsai Tree',
        totalPrice: 35,
      });
      const { score, signals } = service.scoreListing(listing, '10281', 'Bonsai Tree', 49.99, validSets);
      expect(signals.some((s) => s.signal === 'DISPLAY_ACCESSORY')).toBe(true);
      expect(signals.some((s) => s.signal === 'THIRD_PARTY_PRODUCT')).toBe(true);
      expect(score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });

    it('should flag MOC + missing set + name mismatch', () => {
      const listing = makeListing({
        title: 'LEGO MOC Medieval Village Custom Build Detailed',
        totalPrice: 80,
      });
      const { score } = service.scoreListing(listing, '10305', 'Lion Knights Castle', 349.99, validSets);
      // CUSTOM_MOC (30) + MISSING_SET_NUMBER (15) + NAME_MISMATCH (25) = 70
      expect(score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });

    it('should flag job lot + parts keywords = 45 pts, needs additional signal', () => {
      const listing = makeListing({
        title: 'LEGO Job Lot Mixed Brick Pieces 3kg',
        totalPrice: 25,
      });
      const { score, signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'BUNDLE_LOT')).toBe(true);
      // BUNDLE_LOT (25) + PARTS_PIECES_KEYWORDS (20) + MISSING_SET_NUMBER (15) + NAME_MISMATCH (25) = 85
      expect(score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });

    it('should flag book/magazine with price anomaly', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars Annual 2024 with Mini Figure',
        totalPrice: 8,
      });
      const { score, signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'BOOK_MAGAZINE')).toBe(true);
      // BOOK_MAGAZINE (25) + MISSING_SET_NUMBER (15) + NAME_MISMATCH (25) + PRICE_ANOMALY (20) + LOW_COG (25) = capped 100
      expect(score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });

    it('should cap score at 100 even when multiple signals stack', () => {
      const listing = makeListing({
        title: 'LED Light Kit for LEGO MOC Custom Build Job Lot Instructions Only',
        totalPrice: 5,
      });
      const { score } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(score).toBe(100);
    });
  });

  // ============================================
  // Edge cases
  // ============================================

  describe('edge cases', () => {
    it('should handle empty title', () => {
      const listing = makeListing({ title: '' });
      const { score } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(typeof score).toBe('number');
    });

    it('should handle null amazonPrice', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Millennium Falcon New Sealed',
        totalPrice: 550,
      });
      const { score } = service.scoreListing(listing, '75192', 'Millennium Falcon', null, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should handle null setNumber', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars Set New Sealed',
        totalPrice: 50,
      });
      const { score } = service.scoreListing(listing, null, 'Millennium Falcon', 649.99, validSets);
      expect(typeof score).toBe('number');
    });

    it('should handle null setName', () => {
      const listing = makeListing({
        title: 'LEGO 75192 New Sealed',
        totalPrice: 550,
      });
      const { score } = service.scoreListing(listing, '75192', null, 649.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should handle case insensitivity across all signals', () => {
      const listing = makeListing({
        title: 'LED LIGHT KIT FOR LEGO 75192 MILLENNIUM FALCON',
        totalPrice: 25,
      });
      const { signals } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(signals.some((s) => s.signal === 'LED_LIGHT_KIT')).toBe(true);
      expect(signals.some((s) => s.signal === 'THIRD_PARTY_PRODUCT')).toBe(true);
    });
  });

  // ============================================
  // Real-world scenario tests
  // ============================================

  describe('real-world scenarios', () => {
    it('should exclude: LED light kit that appears as cheapest listing', () => {
      const listing = makeListing({
        title: 'USB Powered LED Light Kit LEGO Technic 42115 Lamborghini Sián',
        totalPrice: 18,
      });
      const { score } = service.scoreListing(listing, '42115', 'Lamborghini Sián FKP 37', 349.99, validSets);
      expect(score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });

    it('should exclude: display stand priced similarly to the set', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Display Stand Efferman Premium Build',
        totalPrice: 40,
      });
      const { score } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      // DISPLAY_ACCESSORY (25) + NAME_MISMATCH (25) = 50
      expect(score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });

    it('should exclude: compatible knockoff building set', () => {
      const listing = makeListing({
        title: 'Building Blocks Compatible With LEGO 75192 Star Wars Falcon',
        totalPrice: 60,
      });
      const { score } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });

    it('should exclude: LEGO magazine listed under set number', () => {
      const listing = makeListing({
        title: 'LEGO Star Wars Magazine Issue 99 with Exclusive Minifigure',
        totalPrice: 6,
      });
      const { score } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });

    it('should NOT exclude: legitimately discounted sealed set', () => {
      const listing = makeListing({
        title: 'LEGO 10281 Bonsai Tree Brand New Sealed BNIB',
        totalPrice: 32,
      });
      const { score } = service.scoreListing(listing, '10281', 'Bonsai Tree', 49.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should NOT exclude: set with "From my collection" description', () => {
      const listing = makeListing({
        title: 'LEGO 75192 Star Wars Millennium Falcon New Sealed From My Collection',
        totalPrice: 580,
      });
      const { score } = service.scoreListing(listing, '75192', 'Millennium Falcon', 649.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });

    it('should NOT exclude: retired set at premium price', () => {
      const listing = makeListing({
        title: 'LEGO 10276 Colosseum New Sealed Retired Hard To Find',
        totalPrice: 450,
      });
      const { score } = service.scoreListing(listing, '10276', 'Colosseum', 549.99, validSets);
      expect(score).toBeLessThan(DEFAULT_THRESHOLD);
    });
  });
});
