import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { PurchaseService } from '@/lib/services';

const UpdatePurchaseSchema = z.object({
  purchase_date: z.string().optional(),
  short_description: z.string().min(1).optional(),
  cost: z.number().positive().optional(),
  source: z.string().nullable().optional(),
  payment_method: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  image_url: z.string().url().nullable().optional().or(z.literal('')),
});

/**
 * GET /api/purchases/[id]
 * Get a single purchase
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new PurchaseService(supabase, user.id);
    const purchase = await service.getById(id);

    if (!purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }

    return NextResponse.json({ data: purchase });
  } catch (error) {
    console.error('[GET /api/purchases/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/purchases/[id]
 * Update a purchase
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = UpdatePurchaseSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new PurchaseService(supabase, user.id);

    // Check if purchase exists first
    const existing = await service.getById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }

    const result = await service.update(id, {
      ...parsed.data,
      image_url: parsed.data.image_url || undefined,
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[PUT /api/purchases/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/purchases/[id]
 * Delete a purchase
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new PurchaseService(supabase, user.id);

    // Check if purchase exists first
    const existing = await service.getById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }

    await service.delete(id);
    return NextResponse.json({ message: 'Purchase deleted successfully' });
  } catch (error) {
    console.error('[DELETE /api/purchases/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
