/**
 * Photo Analysis API Route
 *
 * POST /api/purchase-evaluator/analyze-photos
 *
 * Analyzes photos of LEGO lots using multi-model AI pipeline
 * (Claude Opus + Gemini + Brickognize) to identify items and
 * assess their condition.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { analyzePhotos } from '@/lib/purchase-evaluator/photo-analysis.service';
import type { PhotoAnalysisOptions, AnalysisImageInput } from '@/lib/purchase-evaluator/photo-types';

// ============================================
// Request Validation Schema
// ============================================

const ImageSchema = z.object({
  base64: z.string().min(100, 'Image data too small'),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  filename: z.string().optional(),
});

const AnalyzePhotosRequestSchema = z.object({
  images: z
    .array(ImageSchema)
    .min(1, 'At least one image is required')
    .max(10, 'Maximum 10 images allowed'),
  listingDescription: z.string().max(5000).optional(),
  options: z
    .object({
      useGeminiVerification: z.boolean().optional(),
      useBrickognize: z.boolean().optional(),
    })
    .optional(),
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
    const parsed = AnalyzePhotosRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { images, listingDescription, options } = parsed.data;

    // 3. Check for ANTHROPIC_API_KEY
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'AI service not configured. ANTHROPIC_API_KEY is required.' },
        { status: 503 }
      );
    }

    // 4. Prepare images for analysis
    const analysisImages: AnalysisImageInput[] = images.map((img, index) => ({
      base64: img.base64,
      mediaType: img.mediaType,
      filename: img.filename || `image-${index + 1}.jpg`,
    }));

    // 5. Build analysis options
    const analysisOptions: PhotoAnalysisOptions = {
      useGeminiVerification: options?.useGeminiVerification ?? true,
      useBrickognize: options?.useBrickognize ?? true,
      listingDescription,
    };

    // 6. Run photo analysis
    console.log(
      `[POST /api/purchase-evaluator/analyze-photos] Starting analysis of ${images.length} image(s) for user ${user.id}`
    );

    const result = await analyzePhotos(analysisImages, analysisOptions);

    console.log(
      `[POST /api/purchase-evaluator/analyze-photos] Analysis complete: ${result.items.length} items found, ${result.processingTimeMs}ms`
    );

    // 7. Return result
    return NextResponse.json(
      { data: result },
      { status: 200 }
    );
  } catch (error) {
    console.error('[POST /api/purchase-evaluator/analyze-photos] Error:', error);

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('ANTHROPIC_API_KEY')) {
        return NextResponse.json(
          { error: 'AI service not configured' },
          { status: 503 }
        );
      }

      if (error.message.includes('rate limit')) {
        return NextResponse.json(
          { error: 'AI service rate limit exceeded. Please try again later.' },
          { status: 429 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Photo analysis failed. Please try again.' },
      { status: 500 }
    );
  }
}

// ============================================
// OPTIONS Handler (CORS)
// ============================================

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
