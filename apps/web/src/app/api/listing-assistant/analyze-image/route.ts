/**
 * Analyze Image API Route
 *
 * POST /api/listing-assistant/analyze-image - Analyze an image with Gemini
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { analyzeProductImage } from '@/lib/listing-assistant/ai-service';

const AnalyzeImageSchema = z.object({
  imageBase64: z.string().min(1, 'Image is required'),
});

/**
 * POST /api/listing-assistant/analyze-image
 * Analyze an image for alt text, defects, and suggested filename
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = AnalyzeImageSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { imageBase64 } = parsed.data;

    console.log('[AnalyzeImage] Analyzing image with Gemini...');
    const result = await analyzeProductImage(imageBase64);

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/listing-assistant/analyze-image] Error:', error);

    if (error instanceof Error) {
      if (error.message.includes('GOOGLE_AI_API_KEY')) {
        return NextResponse.json(
          { error: 'Image analysis not configured. Please check API keys.' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ error: 'Failed to analyze image' }, { status: 500 });
  }
}
