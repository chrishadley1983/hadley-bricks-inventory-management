/**
 * Transaction Tags Route
 *
 * GET /api/transactions/tags - List user's tags
 * POST /api/transactions/tags - Create a new tag
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// Create tag schema
const CreateTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

/**
 * GET - List user's tags
 */
export async function GET() {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch tags
    const { data, error } = await supabase
      .from('transaction_tags')
      .select('*')
      .eq('user_id', user.id)
      .order('name', { ascending: true });

    if (error) {
      console.error('[GET /api/transactions/tags] Database error:', error);
      return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('[GET /api/transactions/tags] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST - Create a new tag
 */
export async function POST(request: NextRequest) {
  try {
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
    const parsed = CreateTagSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // 3. Check for existing tag with same name
    const { data: existing } = await supabase
      .from('transaction_tags')
      .select('id')
      .eq('user_id', user.id)
      .eq('name', parsed.data.name)
      .single();

    if (existing) {
      return NextResponse.json({ error: 'Tag with this name already exists' }, { status: 409 });
    }

    // 4. Create tag
    const { data, error } = await supabase
      .from('transaction_tags')
      .insert({
        user_id: user.id,
        name: parsed.data.name,
        color: parsed.data.color || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[POST /api/transactions/tags] Database error:', error);
      return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/transactions/tags] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
