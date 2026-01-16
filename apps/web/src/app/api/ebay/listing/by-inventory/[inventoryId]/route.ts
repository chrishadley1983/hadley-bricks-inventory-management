/**
 * Listing Audit by Inventory ID API
 *
 * GET /api/ebay/listing/by-inventory/[inventoryId]
 *
 * Returns the most recent completed listing creation audit for an inventory item.
 * Used to view generated listing content and quality review after creation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { QualityReviewResult } from '@/lib/ebay/listing-creation.types';

export interface ListingAuditData {
  id: string;
  ebayListingId: string | null;
  ebayListingUrl: string | null;
  generatedTitle: string | null;
  generatedDescription: string | null;
  itemSpecifics: Record<string, string> | null;
  categoryId: string | null;
  categoryName: string | null;
  aiModelUsed: string | null;
  aiConfidenceScore: number | null;
  aiRecommendations: string[] | null;
  qualityScore: number | null;
  qualityFeedback: QualityReviewResult | null;
  listingPrice: number | null;
  descriptionStyle: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ListingAuditResponse {
  audit: ListingAuditData | null;
  error?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ inventoryId: string }> }
): Promise<NextResponse<ListingAuditResponse>> {
  try {
    const { inventoryId } = await params;

    // Validate inventoryId
    if (!inventoryId || inventoryId.length < 10) {
      return NextResponse.json(
        { audit: null, error: 'Invalid inventory ID' },
        { status: 400 }
      );
    }

    // Create authenticated client
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { audit: null, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Fetch the most recent completed audit for this inventory item
    const { data: audit, error: fetchError } = await supabase
      .from('listing_creation_audit')
      .select(`
        id,
        ebay_listing_id,
        generated_title,
        generated_description,
        item_specifics,
        category_id,
        category_name,
        ai_model_used,
        ai_confidence_score,
        ai_recommendations,
        quality_score,
        quality_feedback,
        listing_price,
        description_style,
        created_at,
        completed_at
      `)
      .eq('inventory_item_id', inventoryId)
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchError) {
      // No audit record found is not an error, just return null
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ audit: null });
      }
      console.error('[GET /api/ebay/listing/by-inventory] Fetch error:', fetchError);
      return NextResponse.json(
        { audit: null, error: 'Failed to fetch audit record' },
        { status: 500 }
      );
    }

    if (!audit) {
      return NextResponse.json({ audit: null });
    }

    // Construct eBay listing URL from listing ID
    const ebayListingUrl = audit.ebay_listing_id
      ? `https://www.ebay.co.uk/itm/${audit.ebay_listing_id}`
      : null;

    // Transform to camelCase response
    const response: ListingAuditData = {
      id: audit.id,
      ebayListingId: audit.ebay_listing_id,
      ebayListingUrl,
      generatedTitle: audit.generated_title,
      generatedDescription: audit.generated_description,
      itemSpecifics: audit.item_specifics as Record<string, string> | null,
      categoryId: audit.category_id,
      categoryName: audit.category_name,
      aiModelUsed: audit.ai_model_used,
      aiConfidenceScore: audit.ai_confidence_score,
      aiRecommendations: audit.ai_recommendations as string[] | null,
      qualityScore: audit.quality_score,
      qualityFeedback: audit.quality_feedback as unknown as QualityReviewResult | null,
      listingPrice: audit.listing_price ? Number(audit.listing_price) : null,
      descriptionStyle: audit.description_style,
      createdAt: audit.created_at || new Date().toISOString(),
      completedAt: audit.completed_at,
    };

    return NextResponse.json({ audit: response });
  } catch (error) {
    console.error('[GET /api/ebay/listing/by-inventory] Error:', error);
    return NextResponse.json(
      { audit: null, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
