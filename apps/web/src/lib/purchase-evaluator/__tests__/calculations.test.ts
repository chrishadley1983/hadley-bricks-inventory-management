import { describe, it, expect } from 'vitest';
import {
  calculateCOGPercent,
  calculateEbayProfit,
  calculateItemProfitability,
  allocateCostsByBuyBox,
  allocateCostsProportionally,
  allocateCostsEqually,
  calculateEvaluationSummary,
} from '../calculations';
import type { EvaluationItem } from '../types';

describe('Purchase Evaluator Calculations', () => {
  describe('calculateCOGPercent', () => {
    it('should calculate COG percentage correctly', () => {
      const result = calculateCOGPercent(50, 100);

      expect(result).toBe(50);
    });

    it('should handle decimal values', () => {
      const result = calculateCOGPercent(33.33, 100);

      expect(result).toBeCloseTo(33.33, 2);
    });

    it('should return null for zero cost', () => {
      const result = calculateCOGPercent(0, 100);

      expect(result).toBeNull();
    });

    it('should return null for zero sell price', () => {
      const result = calculateCOGPercent(50, 0);

      expect(result).toBeNull();
    });

    it('should return null for negative cost', () => {
      const result = calculateCOGPercent(-10, 100);

      expect(result).toBeNull();
    });

    it('should return null for negative sell price', () => {
      const result = calculateCOGPercent(50, -100);

      expect(result).toBeNull();
    });

    it('should handle high COG percentage (low margin)', () => {
      const result = calculateCOGPercent(90, 100);

      expect(result).toBe(90);
    });

    it('should handle low COG percentage (high margin)', () => {
      const result = calculateCOGPercent(10, 100);

      expect(result).toBe(10);
    });

    it('should handle COG over 100% (loss scenario)', () => {
      const result = calculateCOGPercent(150, 100);

      expect(result).toBe(150);
    });
  });

  describe('calculateEbayProfit', () => {
    it('should calculate eBay profit correctly', () => {
      const result = calculateEbayProfit(100, 50);

      expect(result).not.toBeNull();
      expect(result!.sellPrice).toBe(100);
      expect(result!.productCost).toBe(50);
    });

    it('should calculate final value fee at 12.8%', () => {
      const result = calculateEbayProfit(100, 50);

      expect(result!.finalValueFee).toBe(12.8);
    });

    it('should calculate regulatory fee at 0.36%', () => {
      const result = calculateEbayProfit(100, 50);

      expect(result!.regulatoryFee).toBe(0.36);
    });

    it('should include per-order fee of £0.30', () => {
      const result = calculateEbayProfit(100, 50);

      expect(result!.perOrderFee).toBe(0.3);
    });

    it('should calculate payment processing fee at 2.5%', () => {
      const result = calculateEbayProfit(100, 50);

      expect(result!.paymentProcessingFee).toBe(2.5);
    });

    it('should include estimated shipping cost of £4.00', () => {
      const result = calculateEbayProfit(100, 50);

      expect(result!.shippingCost).toBe(4);
    });

    it('should calculate total fees correctly', () => {
      const result = calculateEbayProfit(100, 50);

      // 12.8 + 0.36 + 0.30 + 2.5 = 15.96
      expect(result!.totalFees).toBeCloseTo(15.96, 2);
    });

    it('should calculate net payout correctly', () => {
      const result = calculateEbayProfit(100, 50);

      // 100 - 15.96 - 4 = 80.04
      expect(result!.netPayout).toBeCloseTo(80.04, 2);
    });

    it('should calculate total profit correctly', () => {
      const result = calculateEbayProfit(100, 50);

      // 80.04 - 50 = 30.04
      expect(result!.totalProfit).toBeCloseTo(30.04, 2);
    });

    it('should calculate ROI percentage correctly', () => {
      const result = calculateEbayProfit(100, 50);

      // (30.04 / 50) * 100 = 60.08%
      expect(result!.roiPercent).toBeCloseTo(60.08, 1);
    });

    it('should calculate profit margin percentage correctly', () => {
      const result = calculateEbayProfit(100, 50);

      // (30.04 / 100) * 100 = 30.04%
      expect(result!.profitMarginPercent).toBeCloseTo(30.04, 1);
    });

    it('should return null for zero sell price', () => {
      const result = calculateEbayProfit(0, 50);

      expect(result).toBeNull();
    });

    it('should return null for zero product cost', () => {
      const result = calculateEbayProfit(100, 0);

      expect(result).toBeNull();
    });

    it('should return null for negative values', () => {
      expect(calculateEbayProfit(-100, 50)).toBeNull();
      expect(calculateEbayProfit(100, -50)).toBeNull();
    });

    it('should handle low-value items correctly', () => {
      const result = calculateEbayProfit(10, 5);

      expect(result).not.toBeNull();
      expect(result!.sellPrice).toBe(10);
      // Fees will be a higher proportion of low-value items
      expect(result!.totalFees).toBeGreaterThan(0);
    });

    it('should handle high-value items correctly', () => {
      const result = calculateEbayProfit(1000, 500);

      expect(result).not.toBeNull();
      expect(result!.totalProfit).toBeGreaterThan(0);
    });
  });

  describe('calculateItemProfitability', () => {
    it('should calculate profitability for Amazon item with Buy Box price', () => {
      const result = calculateItemProfitability({
        targetPlatform: 'amazon',
        allocatedCost: 50,
        unitCost: null,
        amazonBuyBoxPrice: 100,
        amazonWasPrice: null,
        ebaySoldAvgPrice: null,
        ebayAvgPrice: null,
        userSellPriceOverride: null,
      });

      expect(result).not.toBeNull();
      expect(result!.expectedSellPrice).toBe(100);
    });

    it('should use Amazon Was Price when Buy Box is not available', () => {
      const result = calculateItemProfitability({
        targetPlatform: 'amazon',
        allocatedCost: 50,
        unitCost: null,
        amazonBuyBoxPrice: null,
        amazonWasPrice: 120,
        ebaySoldAvgPrice: null,
        ebayAvgPrice: null,
        userSellPriceOverride: null,
      });

      expect(result).not.toBeNull();
      expect(result!.expectedSellPrice).toBe(120);
    });

    it('should calculate profitability for eBay item with sold average', () => {
      const result = calculateItemProfitability({
        targetPlatform: 'ebay',
        allocatedCost: 50,
        unitCost: null,
        amazonBuyBoxPrice: null,
        amazonWasPrice: null,
        ebaySoldAvgPrice: 90,
        ebayAvgPrice: null,
        userSellPriceOverride: null,
      });

      expect(result).not.toBeNull();
      expect(result!.expectedSellPrice).toBe(90);
    });

    it('should use eBay active average when sold average is not available', () => {
      const result = calculateItemProfitability({
        targetPlatform: 'ebay',
        allocatedCost: 50,
        unitCost: null,
        amazonBuyBoxPrice: null,
        amazonWasPrice: null,
        ebaySoldAvgPrice: null,
        ebayAvgPrice: 85,
        userSellPriceOverride: null,
      });

      expect(result).not.toBeNull();
      expect(result!.expectedSellPrice).toBe(85);
    });

    it('should prefer user sell price override over platform prices', () => {
      const result = calculateItemProfitability({
        targetPlatform: 'amazon',
        allocatedCost: 50,
        unitCost: null,
        amazonBuyBoxPrice: 100,
        amazonWasPrice: 120,
        ebaySoldAvgPrice: null,
        ebayAvgPrice: null,
        userSellPriceOverride: 150,
      });

      expect(result).not.toBeNull();
      expect(result!.expectedSellPrice).toBe(150);
    });

    it('should use unitCost when allocatedCost is not available', () => {
      const result = calculateItemProfitability({
        targetPlatform: 'amazon',
        allocatedCost: null,
        unitCost: 60,
        amazonBuyBoxPrice: 100,
        amazonWasPrice: null,
        ebaySoldAvgPrice: null,
        ebayAvgPrice: null,
        userSellPriceOverride: null,
      });

      expect(result).not.toBeNull();
      // COG should be based on 60
      expect(result!.cogPercent).toBeCloseTo(60, 0);
    });

    it('should return null when no cost available', () => {
      const result = calculateItemProfitability({
        targetPlatform: 'amazon',
        allocatedCost: null,
        unitCost: null,
        amazonBuyBoxPrice: 100,
        amazonWasPrice: null,
        ebaySoldAvgPrice: null,
        ebayAvgPrice: null,
        userSellPriceOverride: null,
      });

      expect(result).toBeNull();
    });

    it('should return null when no sell price available', () => {
      const result = calculateItemProfitability({
        targetPlatform: 'amazon',
        allocatedCost: 50,
        unitCost: null,
        amazonBuyBoxPrice: null,
        amazonWasPrice: null,
        ebaySoldAvgPrice: null,
        ebayAvgPrice: null,
        userSellPriceOverride: null,
      });

      expect(result).toBeNull();
    });

    it('should return null for zero cost', () => {
      const result = calculateItemProfitability({
        targetPlatform: 'amazon',
        allocatedCost: 0,
        unitCost: null,
        amazonBuyBoxPrice: 100,
        amazonWasPrice: null,
        ebaySoldAvgPrice: null,
        ebayAvgPrice: null,
        userSellPriceOverride: null,
      });

      expect(result).toBeNull();
    });

    it('should ignore zero user override and use platform price', () => {
      const result = calculateItemProfitability({
        targetPlatform: 'amazon',
        allocatedCost: 50,
        unitCost: null,
        amazonBuyBoxPrice: 100,
        amazonWasPrice: null,
        ebaySoldAvgPrice: null,
        ebayAvgPrice: null,
        userSellPriceOverride: 0,
      });

      expect(result).not.toBeNull();
      expect(result!.expectedSellPrice).toBe(100);
    });
  });

  describe('allocateCostsByBuyBox', () => {
    it('should allocate costs proportionally by Buy Box price', () => {
      const items = [
        { amazonBuyBoxPrice: 100, amazonWasPrice: null, userSellPriceOverride: null, quantity: 1 },
        { amazonBuyBoxPrice: 200, amazonWasPrice: null, userSellPriceOverride: null, quantity: 1 },
      ];

      const result = allocateCostsByBuyBox(items, 150);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeCloseTo(50, 2); // 100/300 * 150 = 50
      expect(result[1]).toBeCloseTo(100, 2); // 200/300 * 150 = 100
    });

    it('should use Was Price when Buy Box is not available', () => {
      const items = [
        { amazonBuyBoxPrice: null, amazonWasPrice: 100, userSellPriceOverride: null, quantity: 1 },
        { amazonBuyBoxPrice: null, amazonWasPrice: 200, userSellPriceOverride: null, quantity: 1 },
      ];

      const result = allocateCostsByBuyBox(items, 150);

      expect(result[0]).toBeCloseTo(50, 2);
      expect(result[1]).toBeCloseTo(100, 2);
    });

    it('should use user override when other prices not available', () => {
      const items = [
        { amazonBuyBoxPrice: null, amazonWasPrice: null, userSellPriceOverride: 100, quantity: 1 },
        { amazonBuyBoxPrice: null, amazonWasPrice: null, userSellPriceOverride: 100, quantity: 1 },
      ];

      const result = allocateCostsByBuyBox(items, 100);

      expect(result[0]).toBeCloseTo(50, 2);
      expect(result[1]).toBeCloseTo(50, 2);
    });

    it('should allocate £0 to items without any pricing', () => {
      const items = [
        { amazonBuyBoxPrice: 100, amazonWasPrice: null, userSellPriceOverride: null, quantity: 1 },
        { amazonBuyBoxPrice: null, amazonWasPrice: null, userSellPriceOverride: null, quantity: 1 },
      ];

      const result = allocateCostsByBuyBox(items, 100);

      expect(result[0]).toBe(100); // All cost goes to item with price
      expect(result[1]).toBe(0); // No price = no allocation
    });

    it('should consider quantity in total effective price calculation', () => {
      const items = [
        { amazonBuyBoxPrice: 100, amazonWasPrice: null, userSellPriceOverride: null, quantity: 2 },
        { amazonBuyBoxPrice: 100, amazonWasPrice: null, userSellPriceOverride: null, quantity: 1 },
      ];

      const result = allocateCostsByBuyBox(items, 300);

      // Total effective price = 100*2 + 100*1 = 300
      // Cost per price unit = 300/300 = 1
      // Both items have same price (100), so both get same unit cost allocation
      // Item 1 unit cost: 100 * 1 = 100
      // Item 2 unit cost: 100 * 1 = 100
      // (The function returns per-unit cost, not total cost per item)
      expect(result[0]).toBeCloseTo(100, 2);
      expect(result[1]).toBeCloseTo(100, 2);
    });

    it('should return all zeros when no items have pricing', () => {
      const items = [
        { amazonBuyBoxPrice: null, amazonWasPrice: null, userSellPriceOverride: null, quantity: 1 },
        { amazonBuyBoxPrice: null, amazonWasPrice: null, userSellPriceOverride: null, quantity: 1 },
      ];

      const result = allocateCostsByBuyBox(items, 100);

      expect(result).toEqual([0, 0]);
    });

    it('should return empty array for empty items', () => {
      const result = allocateCostsByBuyBox([], 100);

      expect(result).toEqual([]);
    });

    it('should return all zeros for zero total cost', () => {
      const items = [
        { amazonBuyBoxPrice: 100, amazonWasPrice: null, userSellPriceOverride: null, quantity: 1 },
      ];

      const result = allocateCostsByBuyBox(items, 0);

      expect(result).toEqual([0]);
    });

    it('should prefer Buy Box over Was Price over user override', () => {
      const items = [
        { amazonBuyBoxPrice: 100, amazonWasPrice: 150, userSellPriceOverride: 200, quantity: 1 },
      ];

      const result = allocateCostsByBuyBox(items, 50);

      // Should use Buy Box (100), not Was Price or override
      expect(result[0]).toBe(50);
    });
  });

  describe('allocateCostsProportionally (deprecated)', () => {
    it('should allocate costs proportionally by RRP', () => {
      const items = [
        { ukRetailPrice: 100, quantity: 1 },
        { ukRetailPrice: 200, quantity: 1 },
      ];

      const result = allocateCostsProportionally(items, 150);

      expect(result[0]).toBeCloseTo(50, 2);
      expect(result[1]).toBeCloseTo(100, 2);
    });

    it('should split equally when no items have RRP', () => {
      const items = [
        { ukRetailPrice: null, quantity: 1 },
        { ukRetailPrice: null, quantity: 1 },
      ];

      const result = allocateCostsProportionally(items, 100);

      expect(result[0]).toBe(50);
      expect(result[1]).toBe(50);
    });

    it('should handle empty items', () => {
      const result = allocateCostsProportionally([], 100);

      expect(result).toEqual([]);
    });
  });

  describe('allocateCostsEqually', () => {
    it('should allocate costs equally', () => {
      const items = [{ quantity: 1 }, { quantity: 1 }, { quantity: 1 }];

      const result = allocateCostsEqually(items, 150);

      expect(result).toEqual([50, 50, 50]);
    });

    it('should consider quantity when allocating equally', () => {
      const items = [{ quantity: 2 }, { quantity: 1 }];

      const result = allocateCostsEqually(items, 150);

      // Per-item cost = 150 / 3 = 50
      expect(result[0]).toBe(50); // But this is per-item allocation, not total
      expect(result[1]).toBe(50);
    });

    it('should handle empty items', () => {
      const result = allocateCostsEqually([], 100);

      expect(result).toEqual([]);
    });

    it('should return zeros for zero total cost', () => {
      const items = [{ quantity: 1 }, { quantity: 1 }];

      const result = allocateCostsEqually(items, 0);

      expect(result).toEqual([0, 0]);
    });
  });

  describe('calculateEvaluationSummary', () => {
    const createMockItem = (overrides: Partial<EvaluationItem> = {}): EvaluationItem => ({
      id: 'item-1',
      evaluationId: 'eval-1',
      setNumber: '75192',
      setName: 'Millennium Falcon',
      condition: 'New',
      quantity: 1,
      unitCost: null,
      allocatedCost: 50,
      bricksetSetId: null,
      ukRetailPrice: null,
      ean: null,
      upc: null,
      imageUrl: null,
      targetPlatform: 'amazon',
      amazonAsin: null,
      amazonAsinSource: null,
      amazonAsinConfidence: null,
      amazonAlternativeAsins: null,
      amazonBuyBoxPrice: 100,
      amazonMyPrice: null,
      amazonWasPrice: null,
      amazonOfferCount: null,
      amazonSalesRank: null,
      amazonLookupStatus: 'found',
      amazonLookupError: null,
      ebayMinPrice: null,
      ebayAvgPrice: null,
      ebayMaxPrice: null,
      ebayListingCount: null,
      ebaySoldMinPrice: null,
      ebaySoldAvgPrice: null,
      ebaySoldMaxPrice: null,
      ebaySoldCount: null,
      ebayLookupStatus: 'pending',
      ebayLookupError: null,
      expectedSellPrice: 100,
      cogPercent: 50,
      grossProfit: 30,
      profitMarginPercent: 30,
      roiPercent: 60,
      userSellPriceOverride: null,
      userNotes: null,
      needsReview: false,
      createdAt: '2024-01-15T00:00:00Z',
      updatedAt: '2024-01-15T00:00:00Z',
      ...overrides,
    });

    it('should calculate basic summary statistics', () => {
      const items = [
        createMockItem({ allocatedCost: 50, expectedSellPrice: 100, grossProfit: 30 }),
        createMockItem({ allocatedCost: 75, expectedSellPrice: 150, grossProfit: 45 }),
      ];

      const result = calculateEvaluationSummary(items);

      expect(result.itemCount).toBe(2);
      expect(result.totalCost).toBe(125);
      expect(result.totalExpectedRevenue).toBe(250);
      expect(result.totalGrossProfit).toBe(75);
    });

    it('should handle items with quantity > 1', () => {
      const items = [
        createMockItem({ quantity: 2, allocatedCost: 50, expectedSellPrice: 100, grossProfit: 30 }),
      ];

      const result = calculateEvaluationSummary(items);

      expect(result.totalCost).toBe(100); // 50 * 2
      expect(result.totalExpectedRevenue).toBe(200); // 100 * 2
      expect(result.totalGrossProfit).toBe(60); // 30 * 2
    });

    it('should count items with and without pricing', () => {
      const items = [
        createMockItem({ allocatedCost: 50, expectedSellPrice: 100 }),
        // Must also clear amazonBuyBoxPrice since getEffectiveSellPrice falls back to it
        createMockItem({ allocatedCost: 75, expectedSellPrice: null, amazonBuyBoxPrice: null }),
      ];

      const result = calculateEvaluationSummary(items);

      expect(result.itemsWithCost).toBe(2);
      expect(result.itemsWithPrice).toBe(1);
    });

    it('should count items needing review', () => {
      const items = [
        createMockItem({ needsReview: true }),
        createMockItem({ needsReview: false }),
        createMockItem({ needsReview: true }),
      ];

      const result = calculateEvaluationSummary(items);

      expect(result.itemsNeedingReview).toBe(2);
    });

    it('should calculate overall margin percentage', () => {
      const items = [
        createMockItem({ expectedSellPrice: 100, grossProfit: 30 }),
        createMockItem({ expectedSellPrice: 100, grossProfit: 20 }),
      ];

      const result = calculateEvaluationSummary(items);

      // Total gross profit = 50, Total revenue = 200
      // Margin = 50/200 * 100 = 25%
      expect(result.overallMarginPercent).toBe(25);
    });

    it('should calculate overall ROI percentage', () => {
      const items = [
        createMockItem({ allocatedCost: 50, grossProfit: 30 }),
        createMockItem({ allocatedCost: 50, grossProfit: 20 }),
      ];

      const result = calculateEvaluationSummary(items);

      // Total gross profit = 50, Total cost = 100
      // ROI = 50/100 * 100 = 50%
      expect(result.overallRoiPercent).toBe(50);
    });

    it('should calculate average COG percentage', () => {
      const items = [createMockItem({ cogPercent: 40 }), createMockItem({ cogPercent: 60 })];

      const result = calculateEvaluationSummary(items);

      expect(result.averageCogPercent).toBe(50);
    });

    it('should handle empty items array', () => {
      const result = calculateEvaluationSummary([]);

      expect(result.itemCount).toBe(0);
      expect(result.totalCost).toBe(0);
      expect(result.totalExpectedRevenue).toBe(0);
      expect(result.overallMarginPercent).toBe(0);
      expect(result.overallRoiPercent).toBe(0);
    });

    it('should use unitCost when allocatedCost is null', () => {
      const items = [createMockItem({ allocatedCost: null, unitCost: 60 })];

      const result = calculateEvaluationSummary(items);

      expect(result.totalCost).toBe(60);
    });

    it('should use user sell price override for revenue', () => {
      const items = [
        createMockItem({
          expectedSellPrice: 100,
          userSellPriceOverride: 150,
          allocatedCost: 50,
        }),
      ];

      const result = calculateEvaluationSummary(items);

      expect(result.totalExpectedRevenue).toBe(150); // Should use override
    });

    it('should handle items with null gross profit', () => {
      const items = [createMockItem({ grossProfit: 30 }), createMockItem({ grossProfit: null })];

      const result = calculateEvaluationSummary(items);

      expect(result.totalGrossProfit).toBe(30);
    });
  });
});
