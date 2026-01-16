import { describe, it, expect } from 'vitest';
import {
  formatMonzoAmount,
  isIncome,
  isExpense,
  MONZO_CATEGORIES,
  MONZO_CATEGORY_LABELS,
} from '../types';

describe('Monzo Types and Utilities', () => {
  describe('formatMonzoAmount', () => {
    it('should format positive amounts correctly', () => {
      const result = formatMonzoAmount(10050, 'GBP');
      expect(result).toBe('£100.50');
    });

    it('should format negative amounts correctly', () => {
      const result = formatMonzoAmount(-5025, 'GBP');
      expect(result).toBe('-£50.25');
    });

    it('should handle zero amount', () => {
      const result = formatMonzoAmount(0, 'GBP');
      expect(result).toBe('£0.00');
    });

    it('should format small amounts (pence)', () => {
      const result = formatMonzoAmount(99, 'GBP');
      expect(result).toBe('£0.99');
    });

    it('should format large amounts with proper separators', () => {
      const result = formatMonzoAmount(123456789, 'GBP');
      expect(result).toContain('1,234,567.89');
    });

    it('should default to GBP when currency not specified', () => {
      const result = formatMonzoAmount(1000);
      expect(result).toBe('£10.00');
    });

    it('should handle EUR currency', () => {
      const result = formatMonzoAmount(1000, 'EUR');
      expect(result).toContain('10.00');
      expect(result).toContain('€');
    });

    it('should handle USD currency', () => {
      const result = formatMonzoAmount(1000, 'USD');
      expect(result).toContain('10.00');
    });
  });

  describe('isIncome', () => {
    it('should return true for positive amounts', () => {
      expect(isIncome(1000)).toBe(true);
      expect(isIncome(1)).toBe(true);
      expect(isIncome(999999)).toBe(true);
    });

    it('should return false for negative amounts', () => {
      expect(isIncome(-1000)).toBe(false);
      expect(isIncome(-1)).toBe(false);
    });

    it('should return false for zero', () => {
      expect(isIncome(0)).toBe(false);
    });
  });

  describe('isExpense', () => {
    it('should return true for negative amounts', () => {
      expect(isExpense(-1000)).toBe(true);
      expect(isExpense(-1)).toBe(true);
      expect(isExpense(-999999)).toBe(true);
    });

    it('should return false for positive amounts', () => {
      expect(isExpense(1000)).toBe(false);
      expect(isExpense(1)).toBe(false);
    });

    it('should return false for zero', () => {
      expect(isExpense(0)).toBe(false);
    });
  });

  describe('MONZO_CATEGORIES', () => {
    it('should contain expected categories', () => {
      expect(MONZO_CATEGORIES).toContain('general');
      expect(MONZO_CATEGORIES).toContain('shopping');
      expect(MONZO_CATEGORIES).toContain('eating_out');
      expect(MONZO_CATEGORIES).toContain('transport');
      expect(MONZO_CATEGORIES).toContain('groceries');
    });

    it('should have labels for all categories', () => {
      for (const category of MONZO_CATEGORIES) {
        expect(MONZO_CATEGORY_LABELS[category]).toBeDefined();
        expect(typeof MONZO_CATEGORY_LABELS[category]).toBe('string');
      }
    });
  });

  describe('MONZO_CATEGORY_LABELS', () => {
    it('should have human-readable labels', () => {
      expect(MONZO_CATEGORY_LABELS.eating_out).toBe('Eating Out');
      expect(MONZO_CATEGORY_LABELS.personal_care).toBe('Personal Care');
      expect(MONZO_CATEGORY_LABELS.general).toBe('General');
    });

    it('should not have snake_case in labels', () => {
      for (const label of Object.values(MONZO_CATEGORY_LABELS)) {
        expect(label).not.toContain('_');
      }
    });
  });
});
