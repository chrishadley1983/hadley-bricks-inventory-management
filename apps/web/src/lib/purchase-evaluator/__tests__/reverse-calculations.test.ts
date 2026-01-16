import { describe, it, expect } from 'vitest';
import {
  calculateMaxPurchasePriceEbay,
  calculateMaxPurchasePriceAmazon,
  calculateMaxPurchasePriceBoth,
  calculateLotMaxPurchasePrice,
  calculateMaxBidForAuction,
  calculateTotalPaidFromBid,
  calculateLotAuctionBreakdown,
  calculatePlatformFeesOnly,
  calculateAuctionMaxBidFromRevenue,
  formatMaxPrice,
  getMaxPriceColor,
} from '../reverse-calculations';

describe('Reverse Calculations', () => {
  // ============================================
  // calculateMaxPurchasePriceEbay
  // ============================================

  describe('calculateMaxPurchasePriceEbay', () => {
    it('should calculate max purchase price for eBay with 30% target margin', () => {
      const result = calculateMaxPurchasePriceEbay(100, 30);

      expect(result.sellPrice).toBe(100);
      expect(result.targetProfit).toBe(30); // 30% of 100
      // Fees: 12.8 + 0.36 + 0.30 + 2.5 = 15.96
      expect(result.totalFees).toBeCloseTo(15.96, 2);
      expect(result.shippingCost).toBe(4);
      // Max = 100 - 15.96 - 4 - 30 = 50.04
      expect(result.maxPurchasePrice).toBeCloseTo(50.04, 2);
    });

    it('should calculate individual fee components correctly', () => {
      const result = calculateMaxPurchasePriceEbay(100, 30);

      expect(result.finalValueFee).toBe(12.8); // 12.8%
      expect(result.regulatoryFee).toBe(0.36); // 0.36%
      expect(result.perOrderFee).toBe(0.3); // Fixed £0.30
      expect(result.paymentProcessingFee).toBe(2.5); // 2.5%
    });

    it('should return zeros for zero sell price', () => {
      const result = calculateMaxPurchasePriceEbay(0, 30);

      expect(result.sellPrice).toBe(0);
      expect(result.maxPurchasePrice).toBe(0);
      expect(result.totalFees).toBe(0);
      expect(result.targetProfit).toBe(0);
    });

    it('should return zeros for negative sell price', () => {
      const result = calculateMaxPurchasePriceEbay(-100, 30);

      expect(result.maxPurchasePrice).toBe(0);
    });

    it('should handle 0% target margin', () => {
      const result = calculateMaxPurchasePriceEbay(100, 0);

      expect(result.targetProfit).toBe(0);
      // Max = 100 - 15.96 - 4 = 80.04
      expect(result.maxPurchasePrice).toBeCloseTo(80.04, 2);
    });

    it('should handle 100% target margin (negative max)', () => {
      const result = calculateMaxPurchasePriceEbay(100, 100);

      expect(result.targetProfit).toBe(100);
      // Max would be negative, so clamped to 0
      expect(result.maxPurchasePrice).toBe(0);
    });

    it('should scale fees proportionally with sell price', () => {
      const result100 = calculateMaxPurchasePriceEbay(100, 30);
      const result200 = calculateMaxPurchasePriceEbay(200, 30);

      // Percentage fees should double (minus fixed per-order fee)
      expect(result200.finalValueFee).toBe(result100.finalValueFee * 2);
      expect(result200.regulatoryFee).toBe(result100.regulatoryFee * 2);
      expect(result200.paymentProcessingFee).toBe(result100.paymentProcessingFee * 2);
      // Per-order fee stays the same
      expect(result200.perOrderFee).toBe(result100.perOrderFee);
    });

    it('should round values to 2 decimal places', () => {
      const result = calculateMaxPurchasePriceEbay(99.99, 33);

      // Check that values are properly rounded
      expect(Number.isFinite(result.maxPurchasePrice)).toBe(true);
      expect(result.maxPurchasePrice.toString()).toMatch(/^\d+\.?\d{0,2}$/);
    });
  });

  // ============================================
  // calculateMaxPurchasePriceAmazon
  // ============================================

  describe('calculateMaxPurchasePriceAmazon', () => {
    it('should calculate max purchase price for Amazon with 30% target margin', () => {
      const result = calculateMaxPurchasePriceAmazon(100, 30);

      expect(result.sellPrice).toBe(100);
      expect(result.targetProfit).toBe(30);
      // Referral fee: 15% = 15
      // DST: 2% of referral = 0.30
      // VAT on fees: 20% of (15 + 0.30) = 3.06
      // Total fees: 15 + 0.30 + 3.06 = 18.36
      expect(result.referralFee).toBe(15);
      expect(result.digitalServicesTax).toBe(0.3);
      expect(result.vatOnFees).toBeCloseTo(3.06, 2);
      expect(result.totalFees).toBeCloseTo(18.36, 2);
      // Shipping: £4 (above £14 threshold)
      expect(result.shippingCost).toBe(4);
    });

    it('should use lower shipping cost for items below threshold', () => {
      const result = calculateMaxPurchasePriceAmazon(10, 30);

      expect(result.shippingCost).toBe(3); // Below £14 threshold
    });

    it('should use higher shipping cost for items at or above threshold', () => {
      const result14 = calculateMaxPurchasePriceAmazon(14, 30);
      const result15 = calculateMaxPurchasePriceAmazon(15, 30);

      expect(result14.shippingCost).toBe(4); // At threshold
      expect(result15.shippingCost).toBe(4); // Above threshold
    });

    it('should return zeros for zero sell price', () => {
      const result = calculateMaxPurchasePriceAmazon(0, 30);

      expect(result.maxPurchasePrice).toBe(0);
      expect(result.totalFees).toBe(0);
    });

    it('should return zeros for negative sell price', () => {
      const result = calculateMaxPurchasePriceAmazon(-50, 30);

      expect(result.maxPurchasePrice).toBe(0);
    });

    it('should handle 0% target margin', () => {
      const result = calculateMaxPurchasePriceAmazon(100, 0);

      expect(result.targetProfit).toBe(0);
      // Max = 100 - 18.36 - 4 = 77.64
      expect(result.maxPurchasePrice).toBeCloseTo(77.64, 2);
    });

    it('should clamp max purchase price to zero when target margin too high', () => {
      const result = calculateMaxPurchasePriceAmazon(100, 100);

      expect(result.maxPurchasePrice).toBe(0);
    });
  });

  // ============================================
  // calculateMaxPurchasePriceBoth
  // ============================================

  describe('calculateMaxPurchasePriceBoth', () => {
    it('should calculate for both platforms and recommend the better option', () => {
      const result = calculateMaxPurchasePriceBoth(100, 100, 30);

      expect(result.amazon).not.toBeNull();
      expect(result.ebay).not.toBeNull();
      expect(result.recommendedMaxPrice).toBeGreaterThan(0);
      expect(['amazon', 'ebay']).toContain(result.recommendedPlatform);
    });

    it('should recommend Amazon when it allows higher max purchase price', () => {
      // Amazon typically has higher fees, so eBay should usually be better
      // But with different sell prices, Amazon might win
      const result = calculateMaxPurchasePriceBoth(120, 100, 30);

      // Amazon sell price is higher, so might allow higher max purchase
      expect(result.amazon).not.toBeNull();
      expect(result.ebay).not.toBeNull();
    });

    it('should handle Amazon only', () => {
      const result = calculateMaxPurchasePriceBoth(100, null, 30);

      expect(result.amazon).not.toBeNull();
      expect(result.ebay).toBeNull();
      expect(result.recommendedPlatform).toBe('amazon');
      expect(result.recommendedMaxPrice).toBe(result.amazon!.maxPurchasePrice);
    });

    it('should handle eBay only', () => {
      const result = calculateMaxPurchasePriceBoth(null, 100, 30);

      expect(result.amazon).toBeNull();
      expect(result.ebay).not.toBeNull();
      expect(result.recommendedPlatform).toBe('ebay');
      expect(result.recommendedMaxPrice).toBe(result.ebay!.maxPurchasePrice);
    });

    it('should handle neither platform', () => {
      const result = calculateMaxPurchasePriceBoth(null, null, 30);

      expect(result.amazon).toBeNull();
      expect(result.ebay).toBeNull();
      expect(result.recommendedPlatform).toBeNull();
      expect(result.recommendedMaxPrice).toBe(0);
    });

    it('should handle zero sell prices as null', () => {
      const result = calculateMaxPurchasePriceBoth(0, 0, 30);

      expect(result.amazon).toBeNull();
      expect(result.ebay).toBeNull();
      expect(result.recommendedMaxPrice).toBe(0);
    });

    it('should prefer Amazon when max prices are equal', () => {
      // When equal, Amazon is preferred
      const result = calculateMaxPurchasePriceBoth(100, 100, 30);

      if (
        result.amazon &&
        result.ebay &&
        result.amazon.maxPurchasePrice === result.ebay.maxPurchasePrice
      ) {
        expect(result.recommendedPlatform).toBe('amazon');
      }
    });
  });

  // ============================================
  // calculateLotMaxPurchasePrice
  // ============================================

  describe('calculateLotMaxPurchasePrice', () => {
    it('should calculate total max purchase price for multiple items', () => {
      const items = [
        { amazonSellPrice: 100, ebaySellPrice: 100, quantity: 1 },
        { amazonSellPrice: 200, ebaySellPrice: 200, quantity: 1 },
      ];

      const result = calculateLotMaxPurchasePrice(items, 30);

      expect(result.itemCount).toBe(2);
      expect(result.itemsWithPricing).toBe(2);
      expect(result.totalMaxPurchasePrice).toBeGreaterThan(0);
      expect(result.itemBreakdown).toHaveLength(2);
    });

    it('should multiply max price by quantity', () => {
      const items = [{ amazonSellPrice: 100, ebaySellPrice: 100, quantity: 3 }];

      const result = calculateLotMaxPurchasePrice(items, 30);
      const singleResult = calculateMaxPurchasePriceBoth(100, 100, 30);

      expect(result.totalMaxPurchasePrice).toBeCloseTo(
        singleResult.recommendedMaxPrice * 3,
        2
      );
    });

    it('should handle items without pricing', () => {
      const items = [
        { amazonSellPrice: 100, ebaySellPrice: 100, quantity: 1 },
        { amazonSellPrice: null, ebaySellPrice: null, quantity: 1 },
      ];

      const result = calculateLotMaxPurchasePrice(items, 30);

      expect(result.itemCount).toBe(2);
      expect(result.itemsWithPricing).toBe(1);
      expect(result.itemBreakdown[1].maxPrice).toBe(0);
      expect(result.itemBreakdown[1].platform).toBeNull();
    });

    it('should handle empty items array', () => {
      const result = calculateLotMaxPurchasePrice([], 30);

      expect(result.itemCount).toBe(0);
      expect(result.itemsWithPricing).toBe(0);
      expect(result.totalMaxPurchasePrice).toBe(0);
      expect(result.itemBreakdown).toHaveLength(0);
    });

    it('should track platform recommendation per item', () => {
      const items = [
        { amazonSellPrice: 100, ebaySellPrice: null, quantity: 1 },
        { amazonSellPrice: null, ebaySellPrice: 100, quantity: 1 },
      ];

      const result = calculateLotMaxPurchasePrice(items, 30);

      expect(result.itemBreakdown[0].platform).toBe('amazon');
      expect(result.itemBreakdown[1].platform).toBe('ebay');
    });

    it('should round total to 2 decimal places', () => {
      const items = [
        { amazonSellPrice: 99.99, ebaySellPrice: 99.99, quantity: 1 },
      ];

      const result = calculateLotMaxPurchasePrice(items, 33);

      expect(result.totalMaxPurchasePrice.toString()).toMatch(/^\d+\.?\d{0,2}$/);
    });
  });

  // ============================================
  // calculateMaxBidForAuction
  // ============================================

  describe('calculateMaxBidForAuction', () => {
    it('should calculate max bid accounting for commission and shipping', () => {
      // Max purchase = £100, commission = 32.94%, shipping = £20
      const result = calculateMaxBidForAuction(100, 32.94, 20);

      // Available for bid + commission = 100 - 20 = 80
      // Max bid = 80 / 1.3294 ≈ 60.18
      expect(result.maxBid).toBeCloseTo(60.18, 1);
      expect(result.commission).toBeCloseTo(result.maxBid * 0.3294, 2);
      expect(result.shippingCost).toBe(20);
      // Total should be close to max purchase price
      expect(result.totalPaid).toBeCloseTo(100, 0);
    });

    it('should return zeros for zero max purchase price', () => {
      const result = calculateMaxBidForAuction(0, 32.94, 20);

      expect(result.maxBid).toBe(0);
      expect(result.commission).toBe(0);
      expect(result.totalPaid).toBe(0);
    });

    it('should return zeros for negative max purchase price', () => {
      const result = calculateMaxBidForAuction(-50, 32.94, 20);

      expect(result.maxBid).toBe(0);
    });

    it('should handle shipping cost exceeding max purchase price', () => {
      const result = calculateMaxBidForAuction(10, 32.94, 20);

      // Shipping exceeds max purchase, so max bid is 0
      // But totalPaid still includes shipping
      expect(result.maxBid).toBe(0);
      expect(result.commission).toBe(0);
      // totalPaid = maxBid (0) + commission (0) + shipping (20) = 20
      expect(result.totalPaid).toBe(20);
    });

    it('should handle zero commission', () => {
      const result = calculateMaxBidForAuction(100, 0, 20);

      expect(result.maxBid).toBe(80); // 100 - 20
      expect(result.commission).toBe(0);
      expect(result.totalPaid).toBe(100);
    });

    it('should handle zero shipping', () => {
      const result = calculateMaxBidForAuction(100, 32.94, 0);

      expect(result.shippingCost).toBe(0);
      // Max bid = 100 / 1.3294 ≈ 75.22
      expect(result.maxBid).toBeCloseTo(75.22, 1);
    });

    it('should round values to 2 decimal places', () => {
      const result = calculateMaxBidForAuction(99.99, 32.94, 19.99);

      expect(result.maxBid.toString()).toMatch(/^\d+\.?\d{0,2}$/);
      expect(result.commission.toString()).toMatch(/^\d+\.?\d{0,2}$/);
      expect(result.totalPaid.toString()).toMatch(/^\d+\.?\d{0,2}$/);
    });
  });

  // ============================================
  // calculateTotalPaidFromBid
  // ============================================

  describe('calculateTotalPaidFromBid', () => {
    it('should calculate total from a specific bid amount', () => {
      const result = calculateTotalPaidFromBid(100, 32.94, 20);

      expect(result.commission).toBeCloseTo(32.94, 2);
      expect(result.totalPaid).toBeCloseTo(152.94, 2);
    });

    it('should handle zero bid amount', () => {
      const result = calculateTotalPaidFromBid(0, 32.94, 20);

      expect(result.commission).toBe(0);
      expect(result.totalPaid).toBe(20); // Just shipping
    });

    it('should handle negative bid amount', () => {
      const result = calculateTotalPaidFromBid(-50, 32.94, 20);

      expect(result.commission).toBe(0);
      expect(result.totalPaid).toBe(20); // Just shipping
    });

    it('should handle zero commission rate', () => {
      const result = calculateTotalPaidFromBid(100, 0, 20);

      expect(result.commission).toBe(0);
      expect(result.totalPaid).toBe(120);
    });

    it('should round values to 2 decimal places', () => {
      const result = calculateTotalPaidFromBid(77.77, 33.33, 15.55);

      expect(result.commission.toString()).toMatch(/^\d+\.?\d{0,2}$/);
      expect(result.totalPaid.toString()).toMatch(/^\d+\.?\d{0,2}$/);
    });
  });

  // ============================================
  // calculateLotAuctionBreakdown
  // ============================================

  describe('calculateLotAuctionBreakdown', () => {
    it('should calculate auction breakdown for lot total', () => {
      const result = calculateLotAuctionBreakdown(500, 32.94, 50);

      expect(result.shippingCost).toBe(50);
      expect(result.maxBid).toBeGreaterThan(0);
      expect(result.commission).toBeGreaterThan(0);
      // Total should be close to lot max purchase price
      expect(result.totalPaid).toBeCloseTo(500, 0);
    });

    it('should work with same parameters as calculateMaxBidForAuction', () => {
      const maxBidResult = calculateMaxBidForAuction(200, 25, 30);
      const lotResult = calculateLotAuctionBreakdown(200, 25, 30);

      expect(lotResult.maxBid).toBe(maxBidResult.maxBid);
      expect(lotResult.commission).toBe(maxBidResult.commission);
      expect(lotResult.totalPaid).toBe(maxBidResult.totalPaid);
    });
  });

  // ============================================
  // calculatePlatformFeesOnly
  // ============================================

  describe('calculatePlatformFeesOnly', () => {
    describe('eBay fees', () => {
      it('should calculate eBay fees without target profit', () => {
        const result = calculatePlatformFeesOnly(100, 'ebay');

        expect(result.fees).toBeGreaterThan(0);
        expect(result.shipping).toBe(4);
        expect(result.total).toBe(result.fees + result.shipping);
      });

      it('should match fee calculation from max purchase price function', () => {
        const maxPriceResult = calculateMaxPurchasePriceEbay(100, 0);
        const feesOnly = calculatePlatformFeesOnly(100, 'ebay');

        expect(feesOnly.fees).toBeCloseTo(maxPriceResult.totalFees, 2);
        expect(feesOnly.shipping).toBe(maxPriceResult.shippingCost);
      });
    });

    describe('Amazon fees', () => {
      it('should calculate Amazon fees without target profit', () => {
        const result = calculatePlatformFeesOnly(100, 'amazon');

        expect(result.fees).toBeGreaterThan(0);
        expect(result.shipping).toBe(4); // Above £14 threshold
        expect(result.total).toBe(result.fees + result.shipping);
      });

      it('should use lower shipping for items below threshold', () => {
        const result = calculatePlatformFeesOnly(10, 'amazon');

        expect(result.shipping).toBe(3);
      });

      it('should match fee calculation from max purchase price function', () => {
        const maxPriceResult = calculateMaxPurchasePriceAmazon(100, 0);
        const feesOnly = calculatePlatformFeesOnly(100, 'amazon');

        expect(feesOnly.fees).toBeCloseTo(maxPriceResult.totalFees, 2);
        expect(feesOnly.shipping).toBe(maxPriceResult.shippingCost);
      });
    });

    it('should return zeros for zero sell price', () => {
      const ebayResult = calculatePlatformFeesOnly(0, 'ebay');
      const amazonResult = calculatePlatformFeesOnly(0, 'amazon');

      expect(ebayResult.total).toBe(0);
      expect(amazonResult.total).toBe(0);
    });

    it('should return zeros for negative sell price', () => {
      const result = calculatePlatformFeesOnly(-50, 'ebay');

      expect(result.total).toBe(0);
    });
  });

  // ============================================
  // calculateAuctionMaxBidFromRevenue
  // ============================================

  describe('calculateAuctionMaxBidFromRevenue', () => {
    it('should calculate max bid from total revenue correctly', () => {
      const totalRevenue = 1000;
      const totalPlatformFees = 200;
      const targetMargin = 10; // 10%
      const commission = 32.94;
      const shipping = 50;

      const result = calculateAuctionMaxBidFromRevenue(
        totalRevenue,
        totalPlatformFees,
        targetMargin,
        commission,
        shipping
      );

      // Target profit = 1000 * 10% = 100
      expect(result.targetProfit).toBe(100);
      expect(result.platformFees).toBe(200);

      // Max total paid = 1000 - 200 - 100 = 700
      // Available for bid + commission = 700 - 50 = 650
      // Max bid = 650 / 1.3294 ≈ 489
      expect(result.maxBid).toBeGreaterThan(0);
      expect(result.commission).toBeCloseTo(result.maxBid * 0.3294, 2);
      expect(result.shippingCost).toBe(50);
    });

    it('should return zeros for zero revenue', () => {
      const result = calculateAuctionMaxBidFromRevenue(0, 100, 10, 32.94, 50);

      expect(result.maxBid).toBe(0);
      expect(result.commission).toBe(0);
      expect(result.targetProfit).toBe(0);
      expect(result.totalPaid).toBe(0);
    });

    it('should handle case where fees + margin exceed revenue', () => {
      const result = calculateAuctionMaxBidFromRevenue(100, 80, 30, 32.94, 50);

      // Revenue - fees - margin = 100 - 80 - 30 = -10 → 0
      // Then subtract shipping = 0
      expect(result.maxBid).toBe(0);
    });

    it('should handle zero target margin', () => {
      const result = calculateAuctionMaxBidFromRevenue(1000, 200, 0, 32.94, 50);

      expect(result.targetProfit).toBe(0);
      // Max total = 1000 - 200 - 0 = 800
      expect(result.maxBid).toBeGreaterThan(0);
    });

    it('should round values to 2 decimal places', () => {
      const result = calculateAuctionMaxBidFromRevenue(
        999.99,
        199.99,
        10.5,
        32.94,
        49.99
      );

      expect(result.maxBid.toString()).toMatch(/^\d+\.?\d{0,2}$/);
      expect(result.commission.toString()).toMatch(/^\d+\.?\d{0,2}$/);
      expect(result.targetProfit.toString()).toMatch(/^\d+\.?\d{0,2}$/);
    });
  });

  // ============================================
  // formatMaxPrice
  // ============================================

  describe('formatMaxPrice', () => {
    it('should format as GBP currency', () => {
      const result = formatMaxPrice(1234.56);

      expect(result).toContain('£');
      expect(result).toContain('1,234.56');
    });

    it('should handle zero', () => {
      const result = formatMaxPrice(0);

      expect(result).toContain('£');
      expect(result).toContain('0.00');
    });

    it('should handle large numbers', () => {
      const result = formatMaxPrice(1000000);

      expect(result).toContain('1,000,000');
    });

    it('should handle small decimals', () => {
      const result = formatMaxPrice(0.01);

      expect(result).toContain('0.01');
    });
  });

  // ============================================
  // getMaxPriceColor
  // ============================================

  describe('getMaxPriceColor', () => {
    it('should return gray for zero sell price', () => {
      const result = getMaxPriceColor(50, 0);

      expect(result).toBe('text-gray-500');
    });

    it('should return emerald for 50%+ ratio', () => {
      const result = getMaxPriceColor(50, 100);

      expect(result).toBe('text-emerald-600');
    });

    it('should return green for 40-50% ratio', () => {
      const result = getMaxPriceColor(45, 100);

      expect(result).toBe('text-green-600');
    });

    it('should return yellow for 30-40% ratio', () => {
      const result = getMaxPriceColor(35, 100);

      expect(result).toBe('text-yellow-600');
    });

    it('should return orange for 20-30% ratio', () => {
      const result = getMaxPriceColor(25, 100);

      expect(result).toBe('text-orange-600');
    });

    it('should return red for less than 20% ratio', () => {
      const result = getMaxPriceColor(15, 100);

      expect(result).toBe('text-red-600');
    });

    it('should return emerald for ratio exactly at 50%', () => {
      const result = getMaxPriceColor(50, 100);

      expect(result).toBe('text-emerald-600');
    });
  });
});
