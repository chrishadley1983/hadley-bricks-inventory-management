/**
 * Tests for Seeded Random Utility
 *
 * Tests SCHED2-SCHED3: Reproducible schedule generation with seeded randomization
 */

import { describe, it, expect } from 'vitest';
import { cyrb53, createSeededRandom, createDailySeed } from '../seeded-random';

describe('Seeded Random Utility', () => {
  describe('cyrb53', () => {
    // SCHED2: Uses cyrb53 hash algorithm
    it('should return consistent hash for same input', () => {
      const hash1 = cyrb53('test-input');
      const hash2 = cyrb53('test-input');
      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different inputs', () => {
      const hash1 = cyrb53('input-1');
      const hash2 = cyrb53('input-2');
      expect(hash1).not.toBe(hash2);
    });

    it('should return different hash for different seeds', () => {
      const hash1 = cyrb53('test', 0);
      const hash2 = cyrb53('test', 1);
      expect(hash1).not.toBe(hash2);
    });

    it('should return a number', () => {
      const hash = cyrb53('test');
      expect(typeof hash).toBe('number');
      expect(Number.isFinite(hash)).toBe(true);
    });

    it('should handle empty string', () => {
      const hash = cyrb53('');
      expect(typeof hash).toBe('number');
    });

    it('should handle unicode characters', () => {
      const hash = cyrb53('日本語テスト');
      expect(typeof hash).toBe('number');
      expect(Number.isFinite(hash)).toBe(true);
    });

    it('should produce different hashes for similar strings', () => {
      const hash1 = cyrb53('75192');
      const hash2 = cyrb53('75193');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('createSeededRandom', () => {
    // SCHED3: Same seed produces same sequence
    it('should produce reproducible sequence with same seed', () => {
      const rng1 = createSeededRandom('test-seed');
      const rng2 = createSeededRandom('test-seed');

      const sequence1 = [rng1.next(), rng1.next(), rng1.next()];
      const sequence2 = [rng2.next(), rng2.next(), rng2.next()];

      expect(sequence1).toEqual(sequence2);
    });

    it('should produce different sequence with different seeds', () => {
      const rng1 = createSeededRandom('seed-1');
      const rng2 = createSeededRandom('seed-2');

      const val1 = rng1.next();
      const val2 = rng2.next();

      expect(val1).not.toBe(val2);
    });

    it('should produce values between 0 and 1', () => {
      const rng = createSeededRandom('test');

      for (let i = 0; i < 100; i++) {
        const value = rng.next();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });

    describe('nextInt', () => {
      it('should produce integers within specified range', () => {
        const rng = createSeededRandom('test-int');
        const min = 10;
        const max = 20;

        for (let i = 0; i < 50; i++) {
          const value = rng.nextInt(min, max);
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(min);
          expect(value).toBeLessThanOrEqual(max);
        }
      });

      it('should be reproducible', () => {
        const rng1 = createSeededRandom('int-test');
        const rng2 = createSeededRandom('int-test');

        const seq1 = [rng1.nextInt(0, 100), rng1.nextInt(0, 100), rng1.nextInt(0, 100)];
        const seq2 = [rng2.nextInt(0, 100), rng2.nextInt(0, 100), rng2.nextInt(0, 100)];

        expect(seq1).toEqual(seq2);
      });
    });

    describe('shuffle', () => {
      it('should shuffle array reproducibly', () => {
        const rng1 = createSeededRandom('shuffle-test');
        const rng2 = createSeededRandom('shuffle-test');

        const arr1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const arr2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        // shuffle returns a NEW array
        const shuffled1 = rng1.shuffle(arr1);
        const shuffled2 = rng2.shuffle(arr2);

        expect(shuffled1).toEqual(shuffled2);
      });

      it('should contain all original elements', () => {
        const rng = createSeededRandom('shuffle-elements');
        const original = [1, 2, 3, 4, 5];

        const shuffled = rng.shuffle(original);

        expect([...shuffled].sort()).toEqual([...original].sort());
      });

      it('should actually change order (verified with known seed)', () => {
        // Use a seed that is known to produce a different order
        const rng = createSeededRandom('known-good-shuffle-seed-xyz');
        const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        const shuffled = rng.shuffle(original);

        // At least some elements should be in different positions
        const changedPositions = shuffled.filter((val, idx) => val !== original[idx]);
        expect(changedPositions.length).toBeGreaterThan(0);
      });
    });
  });

  describe('createDailySeed', () => {
    // SCHED2: Seed based on date + watchlist hash
    it('should produce same seed for same date', () => {
      const date = new Date('2026-01-21');
      const seed1 = createDailySeed(date);
      const seed2 = createDailySeed(date);

      expect(seed1).toBe(seed2);
    });

    it('should produce different seed for different dates', () => {
      const seed1 = createDailySeed(new Date('2026-01-21'));
      const seed2 = createDailySeed(new Date('2026-01-22'));

      expect(seed1).not.toBe(seed2);
    });

    it('should accept ISO date string', () => {
      const dateObj = new Date('2026-01-21');
      const dateStr = '2026-01-21';

      const seed1 = createDailySeed(dateObj);
      const seed2 = createDailySeed(dateStr);

      expect(seed1).toBe(seed2);
    });

    it('should incorporate salt into seed', () => {
      const date = new Date('2026-01-21');
      const seed1 = createDailySeed(date, 'salt-1');
      const seed2 = createDailySeed(date, 'salt-2');

      expect(seed1).not.toBe(seed2);
    });

    it('should produce reproducible seed with salt', () => {
      const date = new Date('2026-01-21');
      const salt = 'watchlist-hash-abc123';

      const seed1 = createDailySeed(date, salt);
      const seed2 = createDailySeed(date, salt);

      expect(seed1).toBe(seed2);
    });

    it('should only use date part (ignore time)', () => {
      const date1 = new Date('2026-01-21T08:00:00Z');
      const date2 = new Date('2026-01-21T20:00:00Z');

      const seed1 = createDailySeed(date1);
      const seed2 = createDailySeed(date2);

      expect(seed1).toBe(seed2);
    });
  });

  describe('Schedule Reproducibility Integration', () => {
    // Full integration test for schedule reproducibility
    it('should produce identical schedules for same date and watchlist', () => {
      const date = '2026-01-21';
      const watchlistHash = 'abc123def456';

      const generateMockSchedule = (dateStr: string, hash: string) => {
        const seed = createDailySeed(dateStr, hash);
        const rng = createSeededRandom(seed);

        // Simulate generating 20 scan times
        const times: number[] = [];
        for (let i = 0; i < 20; i++) {
          times.push(rng.nextInt(8 * 60, 22 * 60)); // 8am to 10pm in minutes
        }
        return times.sort((a, b) => a - b);
      };

      const schedule1 = generateMockSchedule(date, watchlistHash);
      const schedule2 = generateMockSchedule(date, watchlistHash);

      expect(schedule1).toEqual(schedule2);
    });

    it('should produce different schedules for different dates', () => {
      const watchlistHash = 'abc123def456';

      const generateMockSchedule = (dateStr: string, hash: string) => {
        const seed = createDailySeed(dateStr, hash);
        const rng = createSeededRandom(seed);
        const times: number[] = [];
        for (let i = 0; i < 5; i++) {
          times.push(rng.nextInt(8 * 60, 22 * 60));
        }
        return times;
      };

      const schedule1 = generateMockSchedule('2026-01-21', watchlistHash);
      const schedule2 = generateMockSchedule('2026-01-22', watchlistHash);

      expect(schedule1).not.toEqual(schedule2);
    });

    it('should produce different schedules for different watchlist hashes', () => {
      const date = '2026-01-21';

      const generateMockSchedule = (dateStr: string, hash: string) => {
        const seed = createDailySeed(dateStr, hash);
        const rng = createSeededRandom(seed);
        const times: number[] = [];
        for (let i = 0; i < 5; i++) {
          times.push(rng.nextInt(8 * 60, 22 * 60));
        }
        return times;
      };

      const schedule1 = generateMockSchedule(date, 'watchlist-v1');
      const schedule2 = generateMockSchedule(date, 'watchlist-v2');

      expect(schedule1).not.toEqual(schedule2);
    });
  });
});
