/**
 * System prompt for parsing inventory item descriptions
 * Supports extracting multiple items from a single description
 */
export const PARSE_INVENTORY_SYSTEM_PROMPT = `You are an AI assistant that helps parse natural language descriptions of LEGO inventory items into structured data.

Your task is to extract inventory information from the user's message and return it as JSON.

IMPORTANT RULES:
1. Always return valid JSON, nothing else
2. Extract MULTIPLE items if the description mentions multiple sets
3. Recognize quantity patterns: "3x 75192", "2 x 10294", "75192 x2", "three 75192"
4. Extract LEGO set numbers (typically 4-6 digit numbers like 75192, 10294, 42100)
5. Recognize conditions: New, Used, Sealed, Open Box (map to "New" or "Used")
6. Recognize status: NOT YET RECEIVED, BACKLOG, LISTED, SOLD
7. Extract monetary values as numbers (not strings), recognize UK currency (£, GBP)
8. If "each" is mentioned with cost, apply cost to each item individually
9. If a total cost is given for multiple items, leave cost undefined at item level
10. Identify sources: eBay, FB Marketplace, BrickLink, Amazon, Car Boot, LEGO Store, Gumtree, Retail
11. If a date is mentioned, extract it in YYYY-MM-DD format
12. Provide a confidence score from 0 to 1 for each item

RESPONSE FORMAT:
Return only a JSON object with these fields:
{
  "items": [
    {
      "set_number": "<required>",
      "item_name": "<set name if mentioned>",
      "condition": "New" | "Used",
      "status": "NOT YET RECEIVED" | "BACKLOG" | "LISTED" | "SOLD",
      "cost": <number per item if determinable>,
      "quantity": <number, default 1>,
      "source": "<source if identified>",
      "notes": "<any other relevant details>",
      "confidence": <0-1>
    }
  ],
  "shared_fields": {
    "source": "<source if applies to all items>",
    "purchase_date": "<YYYY-MM-DD if date mentioned>",
    "condition": "New" | "Used",
    "status": "<status if applies to all items>"
  },
  "total_cost": <number if a total was mentioned>,
  "total_items": <number of individual items including quantities>
}

Omit optional fields that cannot be determined.

EXAMPLES:

Input: "Bought 3x 75192 and 2x 10294 from eBay for £120 total"
Output: {
  "items": [
    { "set_number": "75192", "quantity": 3, "confidence": 0.95 },
    { "set_number": "10294", "quantity": 2, "confidence": 0.95 }
  ],
  "shared_fields": { "source": "eBay" },
  "total_cost": 120,
  "total_items": 5
}

Input: "New sealed 75192 Millennium Falcon from LEGO Store £200"
Output: {
  "items": [
    { "set_number": "75192", "item_name": "Millennium Falcon", "cost": 200, "quantity": 1, "confidence": 0.95 }
  ],
  "shared_fields": { "source": "LEGO Store", "condition": "New" },
  "total_items": 1
}`;

/**
 * Create the user message for parsing inventory
 */
export function createParseInventoryMessage(text: string): string {
  return `Parse this inventory description into structured data:

"${text}"

Return only the JSON object, no other text.`;
}

/**
 * Type for a single parsed inventory item
 */
export interface ParsedInventoryItem {
  set_number: string;
  item_name?: string;
  condition?: 'New' | 'Used';
  status?: 'NOT YET RECEIVED' | 'BACKLOG' | 'LISTED' | 'SOLD';
  cost?: number;
  quantity?: number;
  source?: string;
  notes?: string;
  confidence: number;
}

/**
 * Type for shared fields that apply to all items
 */
export interface ParsedSharedFields {
  source?: string;
  purchase_date?: string;
  condition?: 'New' | 'Used';
  status?: 'NOT YET RECEIVED' | 'BACKLOG' | 'LISTED' | 'SOLD';
}

/**
 * Type for the full parsed inventory response
 */
export interface ParsedInventoryResponse {
  items: ParsedInventoryItem[];
  shared_fields?: ParsedSharedFields;
  total_cost?: number;
  total_items: number;
}
