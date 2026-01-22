import { describe, it, expect } from 'vitest';
import {
  extractSetNumber,
  toBricksetFormat,
  fromBricksetFormat,
  isLegoRelated,
} from '../set-number-extraction';

describe('Set Number Extraction', () => {
  describe('extractSetNumber', () => {
    // Pattern: Standalone 4-5 digit numbers
    it('should extract 4-digit set numbers', () => {
      expect(extractSetNumber('LEGO 1234 Set')).toBe('1234');
      expect(extractSetNumber('Set 9999')).toBe('9999');
    });

    it('should extract 5-digit set numbers', () => {
      expect(extractSetNumber('LEGO 75192 Millennium Falcon')).toBe('75192');
      expect(extractSetNumber('Set 10300 DeLorean')).toBe('10300');
    });

    // Pattern: "Set" prefix
    it('should extract set numbers with "Set" prefix', () => {
      expect(extractSetNumber('Set 12345 Complete')).toBe('12345');
      expect(extractSetNumber('Set: 42156 Technic')).toBe('42156');
      expect(extractSetNumber('Set-76419 Harry Potter')).toBe('76419');
    });

    // Pattern: "LEGO" prefix
    it('should extract set numbers with "LEGO" prefix', () => {
      expect(extractSetNumber('LEGO 75192 Star Wars')).toBe('75192');
      expect(extractSetNumber('LEGO: 10300 Back to the Future')).toBe('10300');
      expect(extractSetNumber('LEGO-42156 Peugeot')).toBe('42156');
    });

    // Pattern: Hash prefix
    it('should extract set numbers with hash prefix', () => {
      expect(extractSetNumber('#42156 Peugeot Technic')).toBe('42156');
      expect(extractSetNumber('Item #75192')).toBe('75192');
    });

    // Exclusions: Compatible/clone items
    it('should return null for compatible/clone items', () => {
      expect(extractSetNumber('Compatible with LEGO 12345')).toBeNull();
      expect(extractSetNumber('LEGO compatible set 12345')).toBeNull();
    });

    it('should return null for MOC items', () => {
      expect(extractSetNumber('MOC 12345 Custom Build')).toBeNull();
      expect(extractSetNumber('LEGO MOC Custom 12345')).toBeNull();
    });

    it('should return null for custom items', () => {
      expect(extractSetNumber('Custom LEGO 12345')).toBeNull();
      expect(extractSetNumber('LEGO custom build 12345')).toBeNull();
    });

    it('should return null for Block Tech items', () => {
      expect(extractSetNumber('Block Tech 12345')).toBeNull();
      expect(extractSetNumber('BLOCK TECH set 12345')).toBeNull();
    });

    // Edge cases
    it('should return null for empty or invalid input', () => {
      expect(extractSetNumber('')).toBeNull();
      expect(extractSetNumber(null as unknown as string)).toBeNull();
      expect(extractSetNumber(undefined as unknown as string)).toBeNull();
    });

    it('should return null for text without set numbers', () => {
      expect(extractSetNumber('Random text without numbers')).toBeNull();
      expect(extractSetNumber('LEGO Star Wars Collection')).toBeNull();
    });

    it('should return null for numbers outside valid range', () => {
      expect(extractSetNumber('LEGO 123')).toBeNull(); // Too short
      expect(extractSetNumber('LEGO 100000')).toBeNull(); // Too long
      expect(extractSetNumber('LEGO 999')).toBeNull(); // Below 1000
    });

    it('should handle mixed case correctly', () => {
      expect(extractSetNumber('lego 75192 MILLENNIUM FALCON')).toBe('75192');
      expect(extractSetNumber('SET 10300 DeLorean')).toBe('10300');
    });

    it('should return first valid set number when multiple present', () => {
      expect(extractSetNumber('Set 75192 includes 10300')).toBe('75192');
    });
  });

  describe('toBricksetFormat', () => {
    it('should append -1 suffix to raw set numbers', () => {
      expect(toBricksetFormat('75192')).toBe('75192-1');
      expect(toBricksetFormat('10300')).toBe('10300-1');
    });

    it('should not modify already formatted set numbers', () => {
      expect(toBricksetFormat('75192-1')).toBe('75192-1');
      expect(toBricksetFormat('10300-2')).toBe('10300-2');
    });

    it('should handle empty input', () => {
      expect(toBricksetFormat('')).toBe('');
      expect(toBricksetFormat(null as unknown as string)).toBeFalsy();
    });
  });

  describe('fromBricksetFormat', () => {
    it('should remove -1 suffix from Brickset format', () => {
      expect(fromBricksetFormat('75192-1')).toBe('75192');
      expect(fromBricksetFormat('10300-1')).toBe('10300');
    });

    it('should not modify raw set numbers', () => {
      expect(fromBricksetFormat('75192')).toBe('75192');
      expect(fromBricksetFormat('10300')).toBe('10300');
    });

    it('should only remove -1 suffix (not other variants)', () => {
      expect(fromBricksetFormat('75192-2')).toBe('75192-2');
      expect(fromBricksetFormat('75192-10')).toBe('75192-10');
    });

    it('should handle empty input', () => {
      expect(fromBricksetFormat('')).toBe('');
      expect(fromBricksetFormat(null as unknown as string)).toBeFalsy();
    });
  });

  describe('isLegoRelated', () => {
    it('should return true for LEGO-related text', () => {
      expect(isLegoRelated('LEGO Star Wars 75192')).toBe(true);
      expect(isLegoRelated('lego set sealed')).toBe(true);
    });

    it('should return false for compatible/clone items', () => {
      expect(isLegoRelated('Compatible with LEGO')).toBe(false);
      expect(isLegoRelated('LEGO compatible blocks')).toBe(false);
    });

    it('should return false for text without LEGO', () => {
      expect(isLegoRelated('Star Wars toy')).toBe(false);
      expect(isLegoRelated('Building blocks')).toBe(false);
    });

    it('should return false for empty input', () => {
      expect(isLegoRelated('')).toBe(false);
      expect(isLegoRelated(null as unknown as string)).toBe(false);
    });
  });
});
