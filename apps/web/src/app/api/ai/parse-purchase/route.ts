import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  sendMessageForJSON,
  PARSE_PURCHASE_SYSTEM_PROMPT,
  createParsePurchaseMessage,
  type ParsedPurchaseResponse,
} from '@/lib/ai';

const RequestSchema = z.object({
  text: z.string().min(1, 'Text is required').max(2000, 'Text too long'),
});

/**
 * POST /api/ai/parse-purchase
 * Parse a natural language purchase description using Claude
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

    // Validate input
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { text } = parsed.data;

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

    // Call Claude to parse the purchase
    try {
      const result = await sendMessageForJSON<ParsedPurchaseResponse>(
        PARSE_PURCHASE_SYSTEM_PROMPT,
        createParsePurchaseMessage(text),
        { temperature: 0.3 }
      );

      // Validate the response has required fields
      if (
        typeof result.short_description !== 'string' ||
        typeof result.cost !== 'number' ||
        typeof result.confidence !== 'number'
      ) {
        throw new Error('Invalid response structure from AI');
      }

      return NextResponse.json({ data: result });
    } catch (aiError) {
      console.error('[POST /api/ai/parse-purchase] AI Error:', aiError);

      // Return a graceful fallback for AI failures
      return NextResponse.json(
        {
          error: 'AI parsing failed',
          details: aiError instanceof Error ? aiError.message : 'Unknown AI error',
          fallback: {
            short_description: text.slice(0, 100),
            cost: 0,
            confidence: 0,
          },
        },
        { status: 422 }
      );
    }
  } catch (error) {
    console.error('[POST /api/ai/parse-purchase] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
