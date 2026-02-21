/**
 * System prompt for calculating distance between UK postcodes
 */
export const CALCULATE_DISTANCE_SYSTEM_PROMPT = `You are an AI assistant that helps estimate driving distances between UK postcodes.

Your task is to estimate the approximate driving distance in miles between two UK postcodes.

IMPORTANT RULES:
1. Always return valid JSON, nothing else
2. Provide distances in miles (as numbers)
3. Round-trip distance should be exactly double the one-way distance
4. If you can't estimate the distance, return null values with an explanation
5. Use your knowledge of UK geography to provide reasonable estimates
6. For major cities and areas, you should know approximate distances

RESPONSE FORMAT:
Return only a JSON object with these fields:
{
  "from_postcode": "<normalized postcode>",
  "to_postcode": "<normalized postcode>",
  "distance_miles": <number or null>,
  "round_trip_miles": <number or null>,
  "estimated": true,
  "explanation": "<brief explanation of how you estimated>"
}`;

/**
 * Create the user message for calculating distance
 */
export function createCalculateDistanceMessage(fromPostcode: string, toPostcode: string): string {
  return `Estimate the driving distance between these UK postcodes:

From: ${fromPostcode}
To: ${toPostcode}

Return only the JSON object, no other text.`;
}

/**
 * Type for the distance calculation response
 */
export interface DistanceResponse {
  from_postcode: string;
  to_postcode: string;
  distance_miles: number | null;
  round_trip_miles: number | null;
  estimated: boolean;
  explanation: string;
}
