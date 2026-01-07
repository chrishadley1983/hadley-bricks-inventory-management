/**
 * Single Transaction Route
 *
 * GET /api/transactions/[id] - Get a single transaction
 * PATCH /api/transactions/[id] - Update transaction notes, local category, or tags
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// Update schema
const UpdateSchema = z.object({
  user_notes: z.string().optional(),
  local_category: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * GET - Get a single transaction
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch transaction
    const { data, error } = await supabase
      .from('monzo_transactions')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
      }
      console.error('[GET /api/transactions/[id]] Database error:', error);
      return NextResponse.json({ error: 'Failed to fetch transaction' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[GET /api/transactions/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH - Update transaction notes, local category, or tags
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse and validate body
    const body = await request.json();
    const parsed = UpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // 3. Verify transaction exists and belongs to user
    const { data: existing, error: checkError } = await supabase
      .from('monzo_transactions')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (checkError || !existing) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // 4. Update transaction
    const updateData: Record<string, unknown> = {};
    if (parsed.data.user_notes !== undefined) {
      updateData.user_notes = parsed.data.user_notes;
    }
    if (parsed.data.local_category !== undefined) {
      updateData.local_category = parsed.data.local_category;
    }
    if (parsed.data.tags !== undefined) {
      updateData.tags = parsed.data.tags;
    }

    const { data, error } = await supabase
      .from('monzo_transactions')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('[PATCH /api/transactions/[id]] Database error:', error);
      return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[PATCH /api/transactions/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
