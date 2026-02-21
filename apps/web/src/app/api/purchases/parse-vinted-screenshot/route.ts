/**
 * Parse Vinted Screenshot API Route
 *
 * POST /api/purchases/parse-vinted-screenshot
 *
 * Analyzes a Vinted app screenshot using Claude Vision to extract purchase information.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { sendMessageWithImagesForJSON, type ImageMediaType } from '@/lib/ai/claude-client';
import {
  PARSE_VINTED_SCREENSHOT_SYSTEM_PROMPT,
  createParseVintedScreenshotMessage,
  type ParseVintedScreenshotResponse,
} from '@/lib/ai/prompts/parse-vinted-screenshot';

// Request validation schema
const RequestSchema = z.object({
  image: z.object({
    base64: z.string().min(100, 'Image data too small'),
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  }),
});

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
    const parsed = RequestSchema.safeParse(body);

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

    // 4. Call Claude Vision to parse the screenshot
    console.log(
      `[POST /api/purchases/parse-vinted-screenshot] Analyzing screenshot for user ${user.id}`
    );

    const result = await sendMessageWithImagesForJSON<ParseVintedScreenshotResponse>(
      PARSE_VINTED_SCREENSHOT_SYSTEM_PROMPT,
      createParseVintedScreenshotMessage(),
      [
        {
          base64: image.base64,
          mediaType: image.mediaType as ImageMediaType,
        },
      ],
      {
        maxTokens: 2048,
        temperature: 0.2, // Lower temperature for more consistent extraction
      }
    );

    console.log(
      `[POST /api/purchases/parse-vinted-screenshot] Found ${result.totalFound} purchases`
    );

    // 5. Return parsed purchases
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (error) {
    console.error('[POST /api/purchases/parse-vinted-screenshot] Error:', error);

    if (error instanceof Error) {
      if (error.message.includes('ANTHROPIC_API_KEY')) {
        return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });
      }

      if (error.message.includes('rate limit')) {
        return NextResponse.json(
          { error: 'AI service rate limit exceeded. Please try again later.' },
          { status: 429 }
        );
      }

      if (error.message.includes('Failed to parse')) {
        return NextResponse.json(
          {
            error:
              'Failed to parse screenshot. Please ensure the image clearly shows Vinted purchases.',
          },
          { status: 422 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Screenshot analysis failed. Please try again.' },
      { status: 500 }
    );
  }
}
