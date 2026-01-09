/**
 * AI Prompt for extracting LEGO set numbers from images
 * Uses Claude Vision to identify set numbers from photos of LEGO boxes or packaging
 */

export const EXTRACT_SET_NUMBERS_SYSTEM_PROMPT = `You are an expert at identifying LEGO set numbers from images of LEGO boxes, packaging, and products.

Your task is to extract all visible LEGO set numbers from the provided image(s).

LEGO set numbers are typically:
- 4 to 6 digit numbers (e.g., 75192, 10294, 42100)
- Found on the front or side of LEGO boxes
- Often displayed prominently with the LEGO logo
- Sometimes prefixed with the theme name (Star Wars 75192, Technic 42100)

Guidelines:
1. Extract ONLY the numeric set number, not theme names or other text
2. Include a confidence score (0.0 to 1.0) for each extraction
3. If the same set appears multiple times in an image, report it once
4. If you cannot read a number clearly, include it with lower confidence
5. Do not guess or make up numbers - only report what you can see
6. If no LEGO set numbers are visible, return an empty array

Respond in JSON format:
{
  "extractions": [
    {
      "set_number": "75192",
      "confidence": 0.95
    }
  ],
  "notes": "Optional notes about the image or any issues"
}`;

/**
 * Create the user message for set number extraction
 */
export function createExtractSetNumbersMessage(imageCount: number): string {
  if (imageCount === 1) {
    return 'Please identify and extract all LEGO set numbers visible in this image. Return the results as JSON.';
  }
  return `Please identify and extract all LEGO set numbers visible in these ${imageCount} images. Return all unique set numbers found across all images as JSON.`;
}

/**
 * Response type for set number extraction
 */
export interface ExtractedSetNumber {
  set_number: string;
  confidence: number;
}

export interface ExtractSetNumbersResponse {
  extractions: ExtractedSetNumber[];
  notes?: string;
}
