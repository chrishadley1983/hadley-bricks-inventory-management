/**
 * Levenshtein Distance Utility
 *
 * Calculates the edit distance between two strings, useful for fuzzy
 * title matching in ASIN discovery.
 */

/**
 * Calculate the Levenshtein distance between two strings
 *
 * The Levenshtein distance is the minimum number of single-character edits
 * (insertions, deletions, substitutions) required to change one word into another.
 *
 * @param a - First string
 * @param b - Second string
 * @returns The edit distance between the two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Create matrix
  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio between two strings (0-1)
 *
 * @param a - First string
 * @param b - Second string
 * @returns Similarity ratio (1 = identical, 0 = completely different)
 */
export function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;

  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLength;
}

/**
 * Normalize a product title for comparison
 *
 * Removes common noise like "LEGO", edition suffixes, special characters,
 * and normalizes whitespace.
 *
 * @param title - Product title to normalize
 * @returns Normalized title
 */
export function normalizeTitle(title: string): string {
  return (
    title
      .toLowerCase()
      // Remove "lego" prefix as it's redundant
      .replace(/^lego\s*/i, '')
      // Remove common noise words
      .replace(/\b(set|building|kit|toy|bricks?|pieces?)\b/gi, '')
      // Remove edition/variant markers
      .replace(/\([^)]*\)/g, '') // Remove parenthetical content
      .replace(/\[[^\]]*\]/g, '') // Remove bracketed content
      // Remove special characters but keep numbers
      .replace(/[^\w\s\d-]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Extract set number from a product title
 *
 * Looks for patterns like "75192", "75192-1", "Set 75192"
 *
 * @param title - Product title
 * @returns Extracted set number or null
 */
export function extractSetNumber(title: string): string | null {
  // Match 4-6 digit numbers that look like LEGO set numbers
  const patterns = [
    /\b(\d{4,6})-?\d?\b/, // 75192 or 75192-1
    /set\s*#?\s*(\d{4,6})/i, // Set 75192, Set #75192
    /#(\d{4,6})\b/, // #75192
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Check if a product title likely refers to a LEGO product
 *
 * @param title - Product title
 * @returns true if the title appears to be a LEGO product
 */
export function isLegoProduct(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return (
    lowerTitle.includes('lego') || lowerTitle.includes('brick') || /\b\d{4,6}-?\d?\b/.test(title) // Has set number pattern
  );
}

/**
 * Calculate match confidence between an Amazon title and a Brickset set name
 *
 * Uses normalized comparison and scales the result to the 60-85% range
 * for fuzzy matches.
 *
 * @param amazonTitle - Amazon product title
 * @param bricksetName - Brickset set name
 * @param setNumber - Optional set number for bonus matching
 * @returns Match confidence (0-100)
 */
export function calculateTitleMatchConfidence(
  amazonTitle: string,
  bricksetName: string,
  setNumber?: string
): number {
  const normalizedAmazon = normalizeTitle(amazonTitle);
  const normalizedBrickset = normalizeTitle(bricksetName);

  // Base similarity from Levenshtein
  const baseSimilarity = similarity(normalizedAmazon, normalizedBrickset);

  // Bonus for set number match
  let setNumberBonus = 0;
  if (setNumber) {
    const cleanSetNumber = setNumber.replace(/-\d+$/, ''); // Remove variant suffix
    if (amazonTitle.includes(cleanSetNumber)) {
      setNumberBonus = 0.2; // 20% bonus for set number match
    }
  }

  // Calculate final confidence
  const totalSimilarity = Math.min(1, baseSimilarity + setNumberBonus);

  // Scale to 60-85 range for fuzzy matches (never report 100% for fuzzy)
  // Higher similarity -> closer to 85
  // Lower similarity -> closer to 60
  const minConfidence = 60;
  const maxConfidence = 85;
  const confidence = minConfidence + totalSimilarity * (maxConfidence - minConfidence);

  return Math.round(confidence);
}
