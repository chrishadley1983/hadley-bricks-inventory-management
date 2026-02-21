import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BricqerClient, normalizeInventoryItems, type BricqerCredentials } from '@/lib/bricqer';
import { CredentialsRepository } from '@/lib/repositories';

const QueryParamsSchema = z.object({
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
  condition: z.enum(['N', 'U']).optional(),
  search: z.string().optional(),
});

/**
 * GET /api/integrations/bricqer/inventory
 * Get inventory items from Bricqer
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query params
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = QueryParamsSchema.safeParse(searchParams);
    const params = parsed.success ? parsed.data : {};

    // Get credentials
    const credentialsRepo = new CredentialsRepository(supabase);
    const credentials = await credentialsRepo.getCredentials<BricqerCredentials>(
      user.id,
      'bricqer'
    );

    if (!credentials) {
      return NextResponse.json({ error: 'Bricqer credentials not configured' }, { status: 400 });
    }

    const client = new BricqerClient(credentials);

    // Fetch inventory items
    const items = await client.getInventoryItems({
      limit: params.limit || 100,
      offset: params.offset || 0,
      condition: params.condition,
      search: params.search,
    });

    // Normalize items
    const normalizedItems = normalizeInventoryItems(items);

    return NextResponse.json({
      data: normalizedItems,
      pagination: {
        limit: params.limit || 100,
        offset: params.offset || 0,
        count: items.length,
      },
    });
  } catch (error) {
    console.error('[GET /api/integrations/bricqer/inventory] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
