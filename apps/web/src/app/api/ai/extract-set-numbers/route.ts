import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  sendMessageWithImagesForJSON,
  EXTRACT_SET_NUMBERS_SYSTEM_PROMPT,
  createExtractSetNumbersMessage,
  type ExtractSetNumbersResponse,
  type ImageMediaType,
} from '@/lib/ai';

const ImageSchema = z.object({
  base64: z.string().min(1, 'Image data is required'),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
});

const RequestSchema = z.object({
  images: z
    .array(ImageSchema)
    .min(1, 'At least one image is required')
    .max(10, 'Maximum 10 images allowed'),
});

/**
 * POST /api/ai/extract-set-numbers
 * Extract LEGO set numbers from images using Claude Vision
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
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { images } = parsed.data;

    // Check if API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        {
          error: 'AI service not configured',
          details: 'ANTHROPIC_API_KEY is not set',
        },
        { status: 503 }
      );
    }

    // Convert to the format expected by the AI client
    const imageInputs = images.map((img) => ({
      base64: img.base64,
      mediaType: img.mediaType as ImageMediaType,
    }));

    // Call Claude Vision API
    const result = await sendMessageWithImagesForJSON<ExtractSetNumbersResponse>(
      EXTRACT_SET_NUMBERS_SYSTEM_PROMPT,
      createExtractSetNumbersMessage(images.length),
      imageInputs,
      {
        maxTokens: 2048,
        temperature: 0.1, // Low temperature for more consistent extraction
      }
    );

    // Validate the response structure
    if (!result.extractions || !Array.isArray(result.extractions)) {
      return NextResponse.json({ error: 'Invalid AI response structure' }, { status: 500 });
    }

    // Ensure all extractions have required fields
    const validatedExtractions = result.extractions
      .map((ext) => ({
        set_number: String(ext.set_number || ''),
        confidence: typeof ext.confidence === 'number' ? ext.confidence : 0.5,
      }))
      .filter((ext) => ext.set_number.length > 0);

    return NextResponse.json({
      data: {
        extractions: validatedExtractions,
        notes: result.notes,
        total_found: validatedExtractions.length,
      },
    });
  } catch (error) {
    console.error('[POST /api/ai/extract-set-numbers] Error:', error);
    return NextResponse.json(
      { error: 'Failed to extract set numbers from images' },
      { status: 500 }
    );
  }
}
