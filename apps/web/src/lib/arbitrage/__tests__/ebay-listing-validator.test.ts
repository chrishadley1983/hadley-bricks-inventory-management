import { describe, it, expect } from 'vitest';
import {
  isValidLegoListing,
  getListingRejectionReason,
} from '../ebay-listing-validator';

describe('eBay Listing Validator', () => {
  // ============================================
  // isValidLegoListing
  // ============================================

  describe('isValidLegoListing', () => {
    // Valid listings
    describe('valid listings', () => {
      it('should accept listing with LEGO in title', () => {
        const title = 'LEGO Star Wars Millennium Falcon 75192 - Brand New';
        expect(isValidLegoListing(title, '75192')).toBe(true);
      });

      it('should accept listing with lowercase "lego"', () => {
        const title = 'lego 40585 World of Wonders Sealed';
        expect(isValidLegoListing(title, '40585')).toBe(true);
      });

      it('should accept listing with mixed case "LEGO"', () => {
        const title = 'LeGo Creator Expert 10276 Colosseum';
        expect(isValidLegoListing(title, '10276')).toBe(true);
      });

      it('should accept listing without set number in title (relies on eBay relevance)', () => {
        // Since eBay search already includes set number, title doesn't need to repeat it
        const title = 'LEGO Star Wars Ultimate Collectors Millennium Falcon';
        expect(isValidLegoListing(title, '75192')).toBe(true);
      });

      it('should accept listing with LEGO anywhere in title', () => {
        const title = 'Brand New Sealed LEGO Set 40585';
        expect(isValidLegoListing(title, '40585')).toBe(true);
      });

      it('should accept listing with LEGO as part of larger word (rare but valid)', () => {
        // "LEGO" appears in the brand name
        const title = 'Official LEGO Star Wars UCS Set';
        expect(isValidLegoListing(title, '75192')).toBe(true);
      });
    });

    // Invalid listings
    describe('invalid listings', () => {
      it('should reject listing without LEGO in title', () => {
        const title = 'Star Wars Millennium Falcon Building Set 75192';
        expect(isValidLegoListing(title, '75192')).toBe(false);
      });

      it('should reject listing with empty title', () => {
        expect(isValidLegoListing('', '75192')).toBe(false);
      });

      it('should reject listing with null title', () => {
        expect(isValidLegoListing(null as unknown as string, '75192')).toBe(false);
      });

      it('should reject listing with undefined title', () => {
        expect(isValidLegoListing(undefined as unknown as string, '75192')).toBe(false);
      });

      it('should reject listing with empty set number', () => {
        expect(isValidLegoListing('LEGO Star Wars 75192', '')).toBe(false);
      });

      it('should reject listing with null set number', () => {
        expect(isValidLegoListing('LEGO Star Wars 75192', null as unknown as string)).toBe(false);
      });

      it('should reject listing with undefined set number', () => {
        expect(isValidLegoListing('LEGO Star Wars 75192', undefined as unknown as string)).toBe(false);
      });

      it('should reject knockoff brand listings (Lepin)', () => {
        // Note: EXCLUDE_PATTERNS are currently disabled, so this might pass
        // This test documents expected behavior if patterns were enabled
        const title = 'Lepin Star Wars Millennium Falcon Building Set';
        // Without "LEGO" in title, it should fail
        expect(isValidLegoListing(title, '75192')).toBe(false);
      });

      it('should reject compatible listings without LEGO branding', () => {
        const title = 'Compatible Building Blocks Star Wars Falcon 75192';
        expect(isValidLegoListing(title, '75192')).toBe(false);
      });
    });

    // Edge cases
    describe('edge cases', () => {
      it('should handle -1 suffix in set number parameter', () => {
        const title = 'LEGO 40585 World of Wonders';
        expect(isValidLegoListing(title, '40585-1')).toBe(true);
      });

      it('should handle -2 variant suffix in set number parameter', () => {
        const title = 'LEGO Star Wars UCS Millennium Falcon 10179';
        expect(isValidLegoListing(title, '10179-2')).toBe(true);
      });

      it('should accept title with only whitespace around LEGO', () => {
        const title = '  LEGO   Star Wars 75192  ';
        expect(isValidLegoListing(title, '75192')).toBe(true);
      });
    });
  });

  // ============================================
  // getListingRejectionReason
  // ============================================

  describe('getListingRejectionReason', () => {
    it('should return null for valid listing', () => {
      const title = 'LEGO Star Wars 75192 Millennium Falcon';
      expect(getListingRejectionReason(title, '75192')).toBeNull();
    });

    it('should return reason for missing title', () => {
      expect(getListingRejectionReason('', '75192')).toBe('Missing title or set number');
    });

    it('should return reason for null title', () => {
      expect(getListingRejectionReason(null as unknown as string, '75192')).toBe(
        'Missing title or set number'
      );
    });

    it('should return reason for missing set number', () => {
      expect(getListingRejectionReason('LEGO 75192', '')).toBe('Missing title or set number');
    });

    it('should return reason for null set number', () => {
      expect(getListingRejectionReason('LEGO 75192', null as unknown as string)).toBe(
        'Missing title or set number'
      );
    });

    it('should return reason when title does not contain LEGO', () => {
      const title = 'Star Wars Millennium Falcon Building Set';
      expect(getListingRejectionReason(title, '75192')).toBe('Title does not contain "LEGO"');
    });

    it('should return null for lowercase lego (since it still contains LEGO)', () => {
      const title = 'lego star wars 75192';
      expect(getListingRejectionReason(title, '75192')).toBeNull();
    });
  });

  // ============================================
  // Real-world listing examples
  // ============================================

  describe('real-world listings', () => {
    // Valid real listings
    it('should accept: LEGO Star Wars Millennium Falcon UCS 75192 - New Sealed', () => {
      expect(
        isValidLegoListing('LEGO Star Wars Millennium Falcon UCS 75192 - New Sealed', '75192')
      ).toBe(true);
    });

    it('should accept: LEGO Ideas Typewriter (21327) Brand New In Sealed Box', () => {
      expect(
        isValidLegoListing('LEGO Ideas Typewriter (21327) Brand New In Sealed Box', '21327')
      ).toBe(true);
    });

    it('should accept: Brand New LEGO Creator Roller Coaster 10261', () => {
      expect(isValidLegoListing('Brand New LEGO Creator Roller Coaster 10261', '10261')).toBe(true);
    });

    it('should accept: NEW LEGO Harry Potter Hogwarts Castle 71043', () => {
      expect(isValidLegoListing('NEW LEGO Harry Potter Hogwarts Castle 71043', '71043')).toBe(true);
    });

    it('should accept listing with emoji', () => {
      expect(isValidLegoListing('LEGO Star Wars 75192 Millennium Falcon ✨ NEW', '75192')).toBe(true);
    });

    // Invalid real listings
    it('should reject: Display Stand for Star Wars Millennium Falcon 75192', () => {
      // No LEGO branding - third party accessory
      expect(
        isValidLegoListing('Display Stand for Star Wars Millennium Falcon 75192', '75192')
      ).toBe(false);
    });

    it('should reject: Brick building set Star Wars spaceship 75192', () => {
      // Generic "brick building set" without LEGO - likely clone
      expect(isValidLegoListing('Brick building set Star Wars spaceship 75192', '75192')).toBe(
        false
      );
    });
  });
});
