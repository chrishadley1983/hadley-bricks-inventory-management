/**
 * eBay Listing Draft API Routes
 *
 * GET /api/ebay/listing/draft - List all drafts for the user
 * POST /api/ebay/listing/draft - Save a new draft
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * Validation schema for saving a draft
 */
const SaveDraftSchema = z.object({
  inventoryItemId: z.string().uuid(),
  draftData: z.object({
    price: z.number().positive().optional(),
    bestOffer: z
      .object({
        enabled: z.boolean(),
        autoAcceptPercent: z.number().min(0).max(100),
        autoDeclinePercent: z.number().min(0).max(100),
      })
      .optional(),
    enhancePhotos: z.boolean().optional(),
    descriptionStyle: z
      .enum(['Minimalist', 'Standard', 'Professional', 'Friendly', 'Enthusiastic'])
      .optional(),
    templateId: z.string().uuid().optional(),
    listingType: z.enum(['draft', 'live', 'scheduled']).optional(),
    scheduledDate: z.string().datetime().optional(),
    policyOverrides: z
      .object({
        fulfillmentPolicyId: z.string().optional(),
        paymentPolicyId: z.string().optional(),
        returnPolicyId: z.string().optional(),
      })
      .optional(),
  }),
});

/**
 * GET /api/ebay/listing/draft
 *
 * List all drafts for the current user
 */
export async function GET() {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch drafts with inventory item info
    const { data: drafts, error } = await supabase
      .from('listing_local_drafts')
      .select(
        `
        id,
        inventory_item_id,
        draft_data,
        error_context,
        created_at,
        updated_at,
        inventory_items (
          set_number,
          item_name,
          condition
        )
      `
      )
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[GET /api/ebay/listing/draft] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch drafts' }, { status: 500 });
    }

    return NextResponse.json({ data: drafts }, { status: 200 });
  } catch (error) {
    console.error('[GET /api/ebay/listing/draft] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/ebay/listing/draft
 *
 * Save a new draft or update existing
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse and validate request
    const body = await request.json();
    const parsed = SaveDraftSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    // Check if draft already exists for this inventory item
    const { data: existingDraft } = await supabase
      .from('listing_local_drafts')
      .select('id')
      .eq('user_id', user.id)
      .eq('inventory_item_id', parsed.data.inventoryItemId)
      .single();

    if (existingDraft) {
      // Update existing draft
      const { data, error } = await supabase
        .from('listing_local_drafts')
        .update({
          draft_data: parsed.data.draftData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingDraft.id)
        .select('id')
        .single();

      if (error) {
        console.error('[POST /api/ebay/listing/draft] Update error:', error);
        return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 });
      }

      return NextResponse.json({ data: { id: data.id, updated: true } }, { status: 200 });
    }

    // Create new draft
    const { data, error } = await supabase
      .from('listing_local_drafts')
      .insert({
        user_id: user.id,
        inventory_item_id: parsed.data.inventoryItemId,
        draft_data: parsed.data.draftData,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[POST /api/ebay/listing/draft] Insert error:', error);
      return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 });
    }

    return NextResponse.json({ data: { id: data.id, created: true } }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/ebay/listing/draft] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
