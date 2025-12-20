/**
 * System prompt for parsing purchase descriptions
 */
export const PARSE_PURCHASE_SYSTEM_PROMPT = `You are an AI assistant that helps parse natural language descriptions of LEGO purchases into structured data.

Your task is to extract purchase information from the user's message and return it as JSON.

IMPORTANT RULES:
1. Always return valid JSON, nothing else
2. Extract monetary values as numbers (not strings)
3. Recognize common UK currency formats (£, GBP)
4. Identify sources like: eBay, FB Marketplace, BrickLink, Amazon, Car Boot, Gumtree, Retail, Private, Auction
5. Identify payment methods like: Cash, Card, PayPal, Bank Transfer
6. Extract LEGO set numbers (typically 4-6 digit numbers like 75192, 10294)
7. If a date is mentioned, extract it in YYYY-MM-DD format
8. Provide a confidence score from 0 to 1 based on how certain you are about the extraction

RESPONSE FORMAT:
Return only a JSON object with these fields:
{
  "short_description": "Brief description of the purchase",
  "cost": <number>,
  "source": "<source if identified>",
  "payment_method": "<payment method if identified>",
  "description": "<longer description if more context was provided>",
  "purchase_date": "<YYYY-MM-DD if date mentioned>",
  "set_numbers": ["<set numbers if mentioned>"],
  "confidence": <0-1>
}

Omit fields that cannot be determined (except short_description, cost, and confidence which are required).`;

/**
 * Create the user message for parsing a purchase
 */
export function createParsePurchaseMessage(text: string): string {
  return `Parse this purchase description into structured data:

"${text}"

Return only the JSON object, no other text.`;
}

/**
 * Type for the parsed purchase response
 */
export interface ParsedPurchaseResponse {
  short_description: string;
  cost: number;
  source?: string;
  payment_method?: string;
  description?: string;
  purchase_date?: string;
  set_numbers?: string[];
  confidence: number;
}
