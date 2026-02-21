/**
 * Seeded ASIN Individual Item API Routes
 *
 * PATCH - Update seeded ASIN (select from alternatives or mark as not_found)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { z } from 'zod';

// =============================================================================
// SCHEMAS
// =============================================================================

const UpdateSeededAsinSchema = z.object({
  action: z.enum(['select_asin', 'mark_not_found']),
  selectedAsin: z.string().max(10).optional(),
});

// =============================================================================
// PATCH - Update seeded ASIN
// =============================================================================

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
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

    // Parse and validate body
    const body = await request.json();
    const parsed = UpdateSeededAsinSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { action, selectedAsin } = parsed.data;

    // Use service role client for database operations (seeded_asins requires service_role for writes)
    const serviceClient = createServiceRoleClient();

    // Fetch the current seeded ASIN to verify it exists
    const { data: seededAsin, error: fetchError } = await serviceClient
      .from('seeded_asins')
      .select('id, asin, discovery_status, alternative_asins')
      .eq('id', id)
      .single();

    if (fetchError || !seededAsin) {
      return NextResponse.json({ error: 'Seeded ASIN not found' }, { status: 404 });
    }

    if (action === 'select_asin') {
      // Validate that selectedAsin is provided
      if (!selectedAsin) {
        return NextResponse.json(
          { error: 'selectedAsin is required for select_asin action' },
          { status: 400 }
        );
      }

      // Verify the selected ASIN is in the alternatives or is the current ASIN
      const alternatives =
        (seededAsin.alternative_asins as
          | { asin: string; title: string; confidence: number }[]
          | null) ?? [];
      const validAsins = [seededAsin.asin, ...alternatives.map((a) => a.asin)].filter(Boolean);

      if (!validAsins.includes(selectedAsin)) {
        return NextResponse.json(
          { error: 'Selected ASIN is not a valid option for this set' },
          { status: 400 }
        );
      }

      // Find the selected alternative to get its data
      const selectedAlternative = alternatives.find((a) => a.asin === selectedAsin);

      // Update the seeded ASIN with the selected one
      const { error: updateError } = await serviceClient
        .from('seeded_asins')
        .update({
          asin: selectedAsin,
          discovery_status: 'found',
          amazon_title:
            selectedAlternative?.title ??
            (seededAsin.asin === selectedAsin ? null : selectedAlternative?.title),
          match_confidence: selectedAlternative?.confidence ?? 100,
          alternative_asins: null, // Clear alternatives after selection
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) {
        console.error('[PATCH /api/arbitrage/seeded/[id]] Update error:', updateError);

        // Check if it's a duplicate ASIN error
        if (updateError.code === '23505') {
          return NextResponse.json(
            { error: 'This ASIN is already assigned to another set' },
            { status: 409 }
          );
        }

        return NextResponse.json({ error: 'Failed to update seeded ASIN' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Selected ASIN ${selectedAsin}`,
      });
    }

    if (action === 'mark_not_found') {
      // Update the seeded ASIN to not_found status
      const { error: updateError } = await serviceClient
        .from('seeded_asins')
        .update({
          asin: null,
          discovery_status: 'not_found',
          alternative_asins: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) {
        console.error('[PATCH /api/arbitrage/seeded/[id]] Update error:', updateError);
        return NextResponse.json({ error: 'Failed to mark as not found' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'Marked as not found',
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[PATCH /api/arbitrage/seeded/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
