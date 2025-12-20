import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BricqerClient, type BricqerCredentials } from '@/lib/bricqer';
import { CredentialsRepository } from '@/lib/repositories';

const QueryParamsSchema = z.object({
  limit: z.coerce.number().optional(),
});

/**
 * GET /api/integrations/bricqer/batches
 * Get purchase batches from Bricqer
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
      return NextResponse.json(
        { error: 'Bricqer credentials not configured' },
        { status: 400 }
      );
    }

    const client = new BricqerClient(credentials);
    const batches = await client.getBatches(params.limit);

    return NextResponse.json({
      data: batches.map((batch) => ({
        id: batch.id,
        purchaseId: batch.purchase,
        reference: batch.reference,
        condition: batch.condition === 'N' ? 'New' : 'Used',
        activated: batch.activated,
        activationDate: batch.activationDate,
        lots: batch.lots,
        itemCount: batch.batchItemCount,
        totalQuantity: batch.totalQuantity,
        remainingQuantity: batch.remainingQuantity,
        totalPrice: parseFloat(batch.totalPrice),
        remainingPrice: parseFloat(batch.remainingPrice),
        supportedShops: batch.supportedShops,
        created: batch.created,
      })),
    });
  } catch (error) {
    console.error('[GET /api/integrations/bricqer/batches] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
