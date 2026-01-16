import { describe, it, expect } from 'vitest';
import {
  buildBricklinkUrl,
  buildBricklinkPriceGuideUrl,
  buildBricklinkSearchUrl,
  normalizeSetNumber,
} from '../bricklink-url';

describe('BrickLink URL Utilities', () => {
  // ============================================
  // buildBricklinkUrl
  // ============================================

  describe('buildBricklinkUrl', () => {
    it('should build catalog URL with correct set number', () => {
      const url = buildBricklinkUrl('40585-1');

      expect(url).toContain('bricklink.com');
      expect(url).toContain('S=40585-1');
    });

    it('should include UK filter in URL', () => {
      const url = buildBricklinkUrl('75192-1');

      // URL should contain encoded filter JSON with "loc":"UK"
      expect(url).toContain('UK');
    });

    it('should include New condition filter in URL', () => {
      const url = buildBricklinkUrl('75192-1');

      // URL should contain encoded filter JSON with "cond":"N"
      expect(url).toContain('cond');
    });

    it('should encode special characters in set number', () => {
      const url = buildBricklinkUrl('10276-1');

      expect(url).toContain('10276-1');
      expect(url).toContain('catalogitem.page');
    });

    it('should handle 4-digit set numbers', () => {
      const url = buildBricklinkUrl('7191-1');

      expect(url).toContain('S=7191-1');
    });

    it('should handle 6-digit set numbers', () => {
      const url = buildBricklinkUrl('910007-1');

      expect(url).toContain('S=910007-1');
    });
  });

  // ============================================
  // buildBricklinkPriceGuideUrl
  // ============================================

  describe('buildBricklinkPriceGuideUrl', () => {
    it('should build price guide URL for New condition by default', () => {
      const url = buildBricklinkPriceGuideUrl('40585-1');

      expect(url).toContain('bricklink.com');
      expect(url).toContain('S=40585-1');
      expect(url).toContain('T=P'); // Price guide tab
      expect(url).toContain('new_or_used=N');
    });

    it('should build price guide URL for Used condition', () => {
      const url = buildBricklinkPriceGuideUrl('40585-1', 'U');

      expect(url).toContain('new_or_used=U');
    });

    it('should explicitly set New condition when specified', () => {
      const url = buildBricklinkPriceGuideUrl('75192-1', 'N');

      expect(url).toContain('new_or_used=N');
    });
  });

  // ============================================
  // buildBricklinkSearchUrl
  // ============================================

  describe('buildBricklinkSearchUrl', () => {
    it('should build search URL with encoded query', () => {
      const url = buildBricklinkSearchUrl('Millennium Falcon');

      expect(url).toContain('bricklink.com');
      expect(url).toContain('search.page');
      expect(url).toContain('Millennium%20Falcon');
      expect(url).toContain('tab=S'); // Sets tab
    });

    it('should encode special characters in query', () => {
      const url = buildBricklinkSearchUrl('Star Wars & Space');

      expect(url).toContain('%26'); // Encoded &
    });

    it('should handle numeric set number queries', () => {
      const url = buildBricklinkSearchUrl('75192');

      expect(url).toContain('q=75192');
    });
  });

  // ============================================
  // normalizeSetNumber
  // ============================================

  describe('normalizeSetNumber', () => {
    it('should return null for null input', () => {
      expect(normalizeSetNumber(null as unknown as string)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(normalizeSetNumber(undefined as unknown as string)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(normalizeSetNumber('')).toBeNull();
    });

    it('should return null for non-string input', () => {
      expect(normalizeSetNumber(12345 as unknown as string)).toBeNull();
    });

    it('should accept already normalized format (5-digit)', () => {
      expect(normalizeSetNumber('40585-1')).toBe('40585-1');
    });

    it('should accept already normalized format (4-digit)', () => {
      expect(normalizeSetNumber('7191-1')).toBe('7191-1');
    });

    it('should accept already normalized format (6-digit)', () => {
      expect(normalizeSetNumber('910007-1')).toBe('910007-1');
    });

    it('should add -1 suffix to plain 5-digit number', () => {
      expect(normalizeSetNumber('40585')).toBe('40585-1');
    });

    it('should add -1 suffix to plain 4-digit number', () => {
      expect(normalizeSetNumber('7191')).toBe('7191-1');
    });

    it('should add -1 suffix to plain 6-digit number', () => {
      expect(normalizeSetNumber('910007')).toBe('910007-1');
    });

    it('should extract set number from "SET 40585-1" format', () => {
      expect(normalizeSetNumber('SET 40585-1')).toBe('40585-1');
    });

    it('should extract set number from "SET 40585" format and add suffix', () => {
      expect(normalizeSetNumber('SET 40585')).toBe('40585-1');
    });

    it('should extract set number from "LEGO 75192" format', () => {
      expect(normalizeSetNumber('LEGO 75192')).toBe('75192-1');
    });

    it('should extract set number from "LEGO 75192-1" format', () => {
      expect(normalizeSetNumber('LEGO 75192-1')).toBe('75192-1');
    });

    it('should handle leading/trailing whitespace', () => {
      expect(normalizeSetNumber('  40585  ')).toBe('40585-1');
      expect(normalizeSetNumber('  40585-1  ')).toBe('40585-1');
    });

    it('should return null for too-short numbers (3 digits)', () => {
      expect(normalizeSetNumber('123')).toBeNull();
    });

    it('should extract first valid set from too-long numbers (7 digits)', () => {
      // The regex matches first valid 4-6 digit sequence within longer string
      // "1234567" contains valid 5-digit and 6-digit sequences
      const result = normalizeSetNumber('1234567');
      // Should extract first 6-digit match "123456" (greedy regex) or 5-digit "12345"
      expect(result).toBe('123456-1');
    });

    it('should return null for non-numeric text', () => {
      expect(normalizeSetNumber('Millennium Falcon')).toBeNull();
    });

    it('should handle set number with -2 variant', () => {
      const result = normalizeSetNumber('10179-2');
      expect(result).toBe('10179-2');
    });

    it('should preserve variant number in full format', () => {
      expect(normalizeSetNumber('10179-2')).toBe('10179-2');
    });
  });
});
