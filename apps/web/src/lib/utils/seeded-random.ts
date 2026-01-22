/**
 * Seeded Random Number Generator
 *
 * Uses cyrb53 hash for deterministic random number generation.
 * Same seed always produces same sequence of random numbers.
 * Used for reproducible schedule generation.
 */

/**
 * cyrb53 hash function
 * Fast, non-cryptographic hash that produces a 53-bit hash
 *
 * @param str - Input string to hash
 * @param seed - Optional seed value
 * @returns 53-bit hash as number
 *
 * @see https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 */
export function cyrb53(str: string, seed: number = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;

  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Create a seeded random number generator
 *
 * @param seed - Seed string (e.g., date string + salt)
 * @returns Object with random functions that produce deterministic results
 *
 * @example
 * const rng = createSeededRandom('2026-01-21');
 * const val1 = rng.next(); // Always same value for same seed
 * const val2 = rng.next(); // Next value in sequence
 */
export function createSeededRandom(seed: string): SeededRandom {
  // Use hash of seed as initial state
  let state = cyrb53(seed);

  /**
   * Simple xorshift32 PRNG
   * Fast and produces good quality random numbers for non-cryptographic use
   */
  function xorshift32(): number {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  }

  return {
    /**
     * Get next random number in range [0, 1)
     */
    next(): number {
      return xorshift32() / 0x100000000;
    },

    /**
     * Get random integer in range [min, max] (inclusive)
     */
    nextInt(min: number, max: number): number {
      const range = max - min + 1;
      return min + Math.floor(this.next() * range);
    },

    /**
     * Shuffle an array in place using Fisher-Yates algorithm
     */
    shuffle<T>(array: T[]): T[] {
      const result = [...array];
      for (let i = result.length - 1; i > 0; i--) {
        const j = this.nextInt(0, i);
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    },

    /**
     * Pick random element from array
     */
    pick<T>(array: T[]): T | undefined {
      if (array.length === 0) return undefined;
      return array[this.nextInt(0, array.length - 1)];
    },

    /**
     * Reset the generator to its initial state
     */
    reset(): void {
      state = cyrb53(seed);
    },
  };
}

/**
 * Seeded random number generator interface
 */
export interface SeededRandom {
  /** Get next random number in range [0, 1) */
  next(): number;
  /** Get random integer in range [min, max] (inclusive) */
  nextInt(min: number, max: number): number;
  /** Shuffle an array using Fisher-Yates */
  shuffle<T>(array: T[]): T[];
  /** Pick random element from array */
  pick<T>(array: T[]): T | undefined;
  /** Reset to initial state */
  reset(): void;
}

/**
 * Create a date-based seed for daily schedule generation
 *
 * @param date - Date object or ISO string
 * @param salt - Optional salt for additional entropy
 * @returns Seed string in format "YYYY-MM-DD:salt"
 *
 * @example
 * const seed = createDailySeed(new Date(), 'vinted-schedule');
 * const rng = createSeededRandom(seed);
 */
export function createDailySeed(date: Date | string, salt: string = ''): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const dateStr = d.toISOString().split('T')[0];
  return salt ? `${dateStr}:${salt}` : dateStr;
}
