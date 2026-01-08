import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BrickLinkUploadService } from '@/lib/services/bricklink-upload.service';

const UpdateUploadSchema = z.object({
  upload_date: z.string().optional(),
  total_quantity: z.number().int().nonnegative().optional(),
  selling_price: z.number().nonnegative().optional(),
  cost: z.number().nonnegative().optional().nullable(),
  source: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  purchase_id: z.string().uuid().optional().nullable(),
  linked_lot: z.string().optional().nullable(),
  lots: z.number().int().nonnegative().optional().nullable(),
  condition: z.enum(['N', 'U']).optional().nullable(),
  reference: z.string().optional().nullable(),
});

/**
 * GET /api/bricklink-uploads/[id]
 * Get a single upload
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

    const service = new BrickLinkUploadService(supabase, user.id);
    const upload = await service.getById(id);

    if (!upload) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    return NextResponse.json({ data: upload });
  } catch (error) {
    console.error('[GET /api/bricklink-uploads/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/bricklink-uploads/[id]
 * Update an upload
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
    const parsed = UpdateUploadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new BrickLinkUploadService(supabase, user.id);

    // Check if upload exists first
    const existing = await service.getById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    const result = await service.update(id, parsed.data);

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[PUT /api/bricklink-uploads/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/bricklink-uploads/[id]
 * Delete an upload
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

    const service = new BrickLinkUploadService(supabase, user.id);

    // Check if upload exists first
    const existing = await service.getById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    await service.delete(id);
    return NextResponse.json({ message: 'Upload deleted successfully' });
  } catch (error) {
    console.error('[DELETE /api/bricklink-uploads/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
