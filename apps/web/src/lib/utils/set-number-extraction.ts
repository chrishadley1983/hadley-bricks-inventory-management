/**
 * LEGO Set Number Extraction Utility
 *
 * Extracts LEGO set numbers from text strings (e.g., listing titles).
 * Used by both manual and automated Vinted arbitrage features.
 */

/**
 * Keywords that indicate a non-LEGO or clone item
 */
const EXCLUSION_KEYWORDS = [
  'compatible',
  'moc ',
  'custom',
  'block tech',
  'lepin',
  'mega bloks',
  'cobi',
  'enlighten',
  'sembo',
  'wange',
];

/**
 * Patterns for extracting LEGO set numbers from text
 * Ordered by specificity - more specific patterns first
 */
const SET_NUMBER_PATTERNS: RegExp[] = [
  /set[:\s-]*(\d{4,5})/i, // "Set 12345" or "Set: 12345"
  /lego[:\s-]*(\d{4,5})/i, // "LEGO 12345" or "LEGO: 12345"
  /#(\d{4,5})/, // "#12345"
  /\b(\d{4,5})\b/, // Standalone 4-5 digit numbers
];

/**
 * Valid set number range
 * LEGO set numbers are typically between 1000 and 99999
 */
const MIN_SET_NUMBER = 1000;
const MAX_SET_NUMBER = 99999;

/**
 * Extract LEGO set number from a text string (e.g., listing title)
 *
 * @param text - The text to extract from (e.g., "LEGO Star Wars 75192 Millennium Falcon")
 * @returns The extracted set number (e.g., "75192") or null if not found
 *
 * @example
 * extractSetNumber("LEGO 75192 Millennium Falcon") // "75192"
 * extractSetNumber("Set 10300 DeLorean") // "10300"
 * extractSetNumber("Compatible with LEGO 12345") // null (excluded)
 * extractSetNumber("Random text without numbers") // null
 */
export function extractSetNumber(text: string): string | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const lowerText = text.toLowerCase();

  // Check for exclusion keywords (non-LEGO items)
  for (const keyword of EXCLUSION_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      return null;
    }
  }

  // Try each pattern in order
  for (const pattern of SET_NUMBER_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      // Validate the number is in the valid range
      if (num >= MIN_SET_NUMBER && num <= MAX_SET_NUMBER) {
        return match[1];
      }
    }
  }

  return null;
}

/**
 * Convert a raw set number to Brickset format by appending "-1" suffix
 *
 * @param setNumber - The raw set number (e.g., "75192")
 * @returns The Brickset format (e.g., "75192-1")
 *
 * @example
 * toBricksetFormat("75192") // "75192-1"
 * toBricksetFormat("75192-1") // "75192-1" (already formatted)
 */
export function toBricksetFormat(setNumber: string): string {
  if (!setNumber) {
    return setNumber;
  }

  // If already in Brickset format, return as-is
  if (setNumber.includes('-')) {
    return setNumber;
  }

  return `${setNumber}-1`;
}

/**
 * Convert a Brickset format set number to raw format by removing "-1" suffix
 *
 * @param setNumber - The Brickset format (e.g., "75192-1")
 * @returns The raw set number (e.g., "75192")
 *
 * @example
 * fromBricksetFormat("75192-1") // "75192"
 * fromBricksetFormat("75192") // "75192" (already raw)
 */
export function fromBricksetFormat(setNumber: string): string {
  if (!setNumber) {
    return setNumber;
  }

  return setNumber.replace(/-1$/, '');
}

/**
 * Check if text appears to be a LEGO-related listing
 *
 * @param text - The text to check
 * @returns true if the text appears to be LEGO-related
 */
export function isLegoRelated(text: string): boolean {
  if (!text) {
    return false;
  }

  const lowerText = text.toLowerCase();

  // Check for LEGO keyword
  if (lowerText.includes('lego')) {
    // But exclude if it's a clone/compatible item
    for (const keyword of EXCLUSION_KEYWORDS) {
      if (lowerText.includes(keyword)) {
        return false;
      }
    }
    return true;
  }

  return false;
}
