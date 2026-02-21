import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { EvaluationConversionService } from '@/lib/services';

/**
 * Schema for inventory item in conversion request
 */
const InventoryItemSchema = z.object({
  set_number: z.string().min(1),
  item_name: z.string().nullable().optional(),
  condition: z.enum(['New', 'Used']).nullable().optional(),
  status: z.string().optional(),
  source: z.string().nullable().optional(),
  cost: z.number().nullable().optional(),
  listing_value: z.number().nullable().optional(),
  listing_platform: z.string().nullable().optional(),
  storage_location: z.string().nullable().optional(),
  amazon_asin: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * Schema for the conversion request
 */
const ConvertEvaluationSchema = z.object({
  purchase: z.object({
    purchase_date: z.string().min(1, 'Purchase date is required'),
    short_description: z.string().min(1, 'Description is required'),
    cost: z.number().positive('Cost must be positive'),
    source: z.string().nullable().optional(),
    payment_method: z.string().nullable().optional(),
    reference: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  }),
  inventoryItems: z.array(InventoryItemSchema).min(1, 'At least one inventory item is required'),
});

/**
 * POST /api/purchase-evaluator/[id]/convert
 * Convert an evaluation to a purchase and inventory items
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: evaluationId } = await params;

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = ConvertEvaluationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const conversionService = new EvaluationConversionService(supabase, user.id);

    // Validate the evaluation can be converted
    const validationError = await conversionService.validateConversion(evaluationId);
    if (validationError) {
      return NextResponse.json(
        { error: validationError.message, code: validationError.code },
        { status: 400 }
      );
    }

    // Perform the conversion
    const result = await conversionService.convert(evaluationId, {
      purchase: {
        purchase_date: parsed.data.purchase.purchase_date,
        short_description: parsed.data.purchase.short_description,
        cost: parsed.data.purchase.cost,
        source: parsed.data.purchase.source ?? null,
        payment_method: parsed.data.purchase.payment_method ?? null,
        reference: parsed.data.purchase.reference ?? null,
        description: parsed.data.purchase.description ?? null,
      },
      inventoryItems: parsed.data.inventoryItems.map((item) => ({
        set_number: item.set_number,
        item_name: item.item_name ?? '',
        condition: item.condition ?? null,
        status: item.status ?? 'NOT YET RECEIVED',
        source: item.source ?? '',
        cost: item.cost ?? null,
        listing_value: item.listing_value ?? null,
        listing_platform: item.listing_platform ?? '',
        storage_location: item.storage_location ?? '',
        amazon_asin: item.amazon_asin ?? '',
        sku: item.sku ?? '',
        notes: item.notes ?? '',
      })),
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/purchase-evaluator/[id]/convert] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
