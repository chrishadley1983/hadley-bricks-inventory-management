/**
 * Vinted Opportunity by ID API
 *
 * PATCH - Update opportunity status
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const UpdateSchema = z.object({
  status: z.enum(['active', 'purchased', 'expired', 'dismissed']),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  // Check auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse body
  const body = await request.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Update opportunity
  const { data, error } = await supabase
    .from('vinted_opportunities')
    .update({ status: parsed.data.status })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) {
    console.error('[opportunity] Update error:', error);
    return NextResponse.json({ error: 'Failed to update opportunity' }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
  }

  return NextResponse.json({ opportunity: data });
}
