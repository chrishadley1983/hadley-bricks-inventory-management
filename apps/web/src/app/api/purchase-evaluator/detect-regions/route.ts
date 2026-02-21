/**
 * Region Detection API Route
 *
 * POST /api/purchase-evaluator/detect-regions
 *
 * Detects item regions in photos for client-side chunking.
 * This is a lightweight endpoint that only does region detection,
 * returning bounding boxes for items so the client can crop before
 * sending to the full analysis endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  detectItemRegions,
  type RegionDetectionResult,
} from '@/lib/purchase-evaluator/image-chunking.service';
import type { AnalysisImageInput } from '@/lib/purchase-evaluator/photo-types';

// ============================================
// Request Validation Schema
// ============================================

const ImageSchema = z.object({
  base64: z.string().min(100, 'Image data too small'),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  filename: z.string().optional(),
});

const DetectRegionsRequestSchema = z.object({
  image: ImageSchema,
});

// ============================================
// POST Handler
// ============================================

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

    // 2. Validate request body
    const body = await request.json();
    const parsed = DetectRegionsRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { image } = parsed.data;

    // 3. Check for ANTHROPIC_API_KEY
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'AI service not configured. ANTHROPIC_API_KEY is required.' },
        { status: 503 }
      );
    }

    // 4. Prepare image for detection
    const analysisImage: AnalysisImageInput = {
      base64: image.base64,
      mediaType: image.mediaType,
      filename: image.filename || 'image.jpg',
    };

    // 5. Run region detection
    console.log(
      `[POST /api/purchase-evaluator/detect-regions] Starting detection for user ${user.id}`
    );

    const result: RegionDetectionResult = await detectItemRegions(analysisImage);

    console.log(
      `[POST /api/purchase-evaluator/detect-regions] Detection complete: ${result.regions.length} regions, shouldChunk: ${result.shouldChunk}`
    );

    // 6. Return result
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (error) {
    console.error('[POST /api/purchase-evaluator/detect-regions] Error:', error);

    return NextResponse.json(
      { error: 'Region detection failed. Please try again.' },
      { status: 500 }
    );
  }
}
