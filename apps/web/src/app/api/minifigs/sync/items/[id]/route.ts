import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { ListingActionsService } from '@/lib/minifig-sync/listing-actions.service';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const { data, error } = await supabase
      .from('minifig_sync_items')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[GET /api/minifigs/sync/items/:id] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch item' }, { status: 500 });
  }
}

const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  price: z.number().positive().optional(),
  condition: z.string().optional(),
  conditionDescription: z.string().optional(),
  categoryId: z.string().optional(),
  aspects: z.record(z.string(), z.array(z.string())).optional(),
  images: z.array(z.object({ url: z.string(), source: z.string(), type: z.string() })).optional(),
  bestOfferAutoAccept: z.number().positive().optional(),
  bestOfferAutoDecline: z.number().positive().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new ListingActionsService(supabase, user.id);
    const result = await service.updateItem(id, parsed.data);

    return NextResponse.json({
      data: {
        success: true,
        ...(result.ebayWarnings.length > 0 && { ebayWarnings: result.ebayWarnings }),
      },
    });
  } catch (error) {
    console.error('[PATCH /api/minifigs/sync/items/:id] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to update item',
        details: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
