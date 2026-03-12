/**
 * LEGO Set Number Identifier
 *
 * Extracts LEGO set numbers from eBay auction titles and descriptions.
 * Filters out false positives (minifigs, accessories, instructions, etc.)
 */

import type { IdentifiedSet } from './types';

// Patterns that indicate this is NOT a complete set
const FALSE_POSITIVE_PATTERNS = [
  /\bminifig(?:ure)?s?\b/i,
  /\binstructions?\s+only\b/i,
  /\bmanual\s+only\b/i,
  /\bbox\s+only\b/i,
  /\bempty\s+box\b/i,
  /\bspare\s+parts?\b/i,
  /\breplacement\b/i,
  /\bcustom\s+build\b/i,
  /\bMOC\b/,
  /\bcompatible\b/i,
  /\bnot\s+lego\b/i,
  /\blike\s+lego\b/i,
  /\blego\s+style\b/i,
  /\bsticker\s+sheet\b/i,
  /\bbaseplate\s+only\b/i,
  /\bduplo\b/i,
  /\bparts\s+pack\b/i,
  /\bbulk\s+lot\b/i,
  /\bkg\b/i,
  /\bkilogram\b/i,
  /\b\d+\s*pieces?\s+mixed\b/i,
];

// Patterns that indicate a joblot/bundle
const JOBLOT_PATTERNS = [
  /\bjob\s*lot\b/i,
  /\bbundle\b/i,
  /\bcollection\b/i,
  /\b(?:x|×)\s*\d+\s*sets?\b/i,
  /\bmultiple\s+sets?\b/i,
  /\blot\s+of\b/i,
  /\bsets?\s+x\s*\d+/i,
];

// Patterns that indicate NEW/SEALED condition
const NEW_SEALED_PATTERNS = [
  /\bnew\b/i,
  /\bsealed\b/i,
  /\bBNIB\b/i,
  /\bBNISB\b/i,
  /\bmisb\b/i,
  /\bunopened\b/i,
  /\bbrand\s+new\b/i,
  /\bfactory\s+sealed\b/i,
  /\bfactory\s+wrapped\b/i,
  /\bretired\s+new\b/i,
  /\bnew\s+&?\s*sealed\b/i,
  /\boriginal\s+packaging\b/i,
];

/**
 * Extract LEGO set numbers from an auction title.
 * Modern LEGO sets are 5-6 digits (10000-99999 or 1000-9999).
 */
export function extractSetNumbers(title: string): IdentifiedSet[] {
  const results: IdentifiedSet[] = [];
  const seen = new Set<string>();

  // Pattern 1: "LEGO <optional text> NNNNN" or "Set NNNNN"
  // High confidence when preceded by LEGO or "Set"
  const legoSetPattern = /\b(?:lego|set)\s+(?:\w+\s+)*?(\d{4,6})\b/gi;
  let match;
  while ((match = legoSetPattern.exec(title)) !== null) {
    const num = match[1];
    if (isValidSetNumber(num) && !seen.has(num)) {
      seen.add(num);
      results.push({ setNumber: num, confidence: 'high', method: 'regex_title' });
    }
  }

  // Pattern 2: Standalone 5-digit number (most modern sets)
  const standalonePattern = /\b(\d{5,6})\b/g;
  while ((match = standalonePattern.exec(title)) !== null) {
    const num = match[0];
    if (isValidSetNumber(num) && !seen.has(num)) {
      seen.add(num);
      // Medium confidence for standalone numbers
      results.push({ setNumber: num, confidence: 'medium', method: 'regex_title' });
    }
  }

  // Pattern 3: 4-digit set numbers (older sets like 7965) - only if preceded by LEGO context
  if (title.toLowerCase().includes('lego')) {
    const fourDigitPattern = /\b(\d{4})\b/g;
    while ((match = fourDigitPattern.exec(title)) !== null) {
      const num = match[0];
      if (isValidSetNumber(num) && !seen.has(num)) {
        seen.add(num);
        results.push({ setNumber: num, confidence: 'low', method: 'regex_title' });
      }
    }
  }

  return results;
}

/**
 * Check if a number looks like a valid LEGO set number.
 * Filters out years (2020-2030), common non-set numbers, etc.
 */
function isValidSetNumber(num: string): boolean {
  const n = parseInt(num, 10);

  // Too small or too large
  if (n < 1000 || n > 999999) return false;

  // Filter out years (2020-2030)
  if (n >= 2020 && n <= 2030) return false;

  // Filter out common non-set numbers
  if (n === 1000 || n === 2000 || n === 5000 || n === 10000) return false;

  return true;
}

/**
 * Check if a title indicates the item is a false positive (not a complete set).
 */
export function isFalsePositive(title: string): boolean {
  return FALSE_POSITIVE_PATTERNS.some((p) => p.test(title));
}

/**
 * Check if a title indicates this is a joblot/bundle.
 */
export function isJoblot(title: string): boolean {
  return JOBLOT_PATTERNS.some((p) => p.test(title));
}

/**
 * Check if title/condition indicates the item is new/sealed.
 */
export function isNewSealed(title: string, condition?: string | null): boolean {
  // eBay condition values for new
  if (condition === 'New' || condition === 'NEW') return true;

  return NEW_SEALED_PATTERNS.some((p) => p.test(title));
}

/**
 * Extract set numbers from a joblot description.
 * Looks for multiple set numbers in the description text.
 */
export function extractJoblotSets(title: string, description?: string): string[] {
  const text = `${title} ${description || ''}`;
  const sets = new Set<string>();

  // Look for all 4-6 digit numbers that could be set numbers
  const pattern = /\b(\d{4,6})\b/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const num = match[1];
    if (isValidSetNumber(num)) {
      sets.add(num);
    }
  }

  return Array.from(sets);
}
