import { NextResponse } from 'next/server';
import { SELLING_PLATFORMS } from '@hadley-bricks/database';

/**
 * GET /api/inventory/platforms
 * Get the list of valid selling platforms for inventory items.
 *
 * Returns a static list instead of querying the database.
 * This ensures consistency and validates against allowed values.
 */
export async function GET() {
  // Return static list of selling platforms
  // No auth required since this is just returning constant values
  return NextResponse.json({ data: [...SELLING_PLATFORMS] });
}
