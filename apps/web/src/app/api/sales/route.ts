import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { SalesService } from '@/lib/services';

const QueryParamsSchema = z.object({
  platform: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
});

const CreateSaleSchema = z.object({
  saleDate: z.string(),
  platform: z.string(),
  saleAmount: z.number().positive(),
  shippingCharged: z.number().optional(),
  shippingCost: z.number().optional(),
  platformFees: z.number().optional(),
  otherCosts: z.number().optional(),
  costOfGoods: z.number().optional(),
  buyerName: z.string().optional(),
  buyerEmail: z.string().email().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  currency: z.string().optional(),
  items: z
    .array(
      z.object({
        itemNumber: z.string(),
        itemName: z.string().optional(),
        itemType: z.string().optional(),
        colorName: z.string().optional(),
        condition: z.enum(['New', 'Used']).optional(),
        quantity: z.number().int().positive(),
        unitPrice: z.number(),
        unitCost: z.number().optional(),
      })
    )
    .optional(),
});

/**
 * GET /api/sales
 * Get sales list with optional filters
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

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = QueryParamsSchema.safeParse(searchParams);
    const params = parsed.success ? parsed.data : {};

    const salesService = new SalesService(supabase);
    const result = await salesService.getSales(user.id, {
      platform: params.platform,
      startDate: params.startDate ? new Date(params.startDate) : undefined,
      endDate: params.endDate ? new Date(params.endDate) : undefined,
      page: params.page,
      pageSize: params.pageSize,
    });

    return NextResponse.json({
      data: result.data,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    console.error('[GET /api/sales] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/sales
 * Create a new manual sale
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = CreateSaleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const salesService = new SalesService(supabase);
    const result = await salesService.createManualSale(user.id, parsed.data);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.sale }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/sales] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
