/**
 * Quality Review Status API
 *
 * GET /api/ebay/listing/[auditId]/quality-review
 *
 * Returns the quality review status and results for a listing creation audit.
 * Used for polling while the review is in progress.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { QualityReviewResult } from '@/lib/ebay/listing-creation.types';

interface QualityReviewResponse {
  status: 'pending' | 'completed' | 'failed';
  review?: QualityReviewResult;
  error?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
): Promise<NextResponse<QualityReviewResponse>> {
  try {
    const { auditId } = await params;

    // Validate auditId
    if (!auditId || auditId.length < 10) {
      return NextResponse.json(
        { status: 'failed', error: 'Invalid audit ID' },
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
        { status: 'failed', error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Fetch audit record
    const { data: audit, error: fetchError } = await supabase
      .from('listing_creation_audit')
      .select('quality_score, quality_feedback, status, error_message')
      .eq('id', auditId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !audit) {
      return NextResponse.json(
        { status: 'failed', error: 'Audit record not found' },
        { status: 404 }
      );
    }

    // If main listing creation failed, return failed status
    if (audit.status === 'failed') {
      return NextResponse.json({
        status: 'failed',
        error: audit.error_message || 'Listing creation failed',
      });
    }

    // Check if quality review is complete
    if (audit.quality_feedback) {
      return NextResponse.json({
        status: 'completed',
        review: audit.quality_feedback as unknown as QualityReviewResult,
      });
    }

    // Quality review still pending
    return NextResponse.json({
      status: 'pending',
    });
  } catch (error) {
    console.error('[GET /api/ebay/listing/[auditId]/quality-review] Error:', error);
    return NextResponse.json(
      { status: 'failed', error: 'Internal server error' },
      { status: 500 }
    );
  }
}
