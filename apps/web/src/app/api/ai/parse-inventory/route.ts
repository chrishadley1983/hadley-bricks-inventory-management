import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  sendMessageForJSON,
  PARSE_INVENTORY_SYSTEM_PROMPT,
  createParseInventoryMessage,
  type ParsedInventoryResponse,
} from '@/lib/ai';

const RequestSchema = z.object({
  text: z.string().min(1, 'Text is required').max(5000, 'Text too long'),
});

/**
 * POST /api/ai/parse-inventory
 * Parse a natural language inventory description using Claude
 * Supports extracting multiple items from a single description
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

    // Call Claude to parse the inventory
    try {
      const result = await sendMessageForJSON<ParsedInventoryResponse>(
        PARSE_INVENTORY_SYSTEM_PROMPT,
        createParseInventoryMessage(text),
        { temperature: 0.3 }
      );

      // Validate the response has required fields
      if (
        !Array.isArray(result.items) ||
        result.items.length === 0 ||
        typeof result.total_items !== 'number'
      ) {
        throw new Error('Invalid response structure from AI');
      }

      // Validate each item has a set_number
      for (const item of result.items) {
        if (typeof item.set_number !== 'string' || !item.set_number) {
          throw new Error('Invalid item structure: missing set_number');
        }
        // Ensure quantity defaults to 1
        if (typeof item.quantity !== 'number') {
          item.quantity = 1;
        }
        // Ensure confidence exists
        if (typeof item.confidence !== 'number') {
          item.confidence = 0.5;
        }
      }

      return NextResponse.json({ data: result });
    } catch (aiError) {
      console.error('[POST /api/ai/parse-inventory] AI Error:', aiError);

      // Return a graceful fallback for AI failures
      return NextResponse.json(
        {
          error: 'AI parsing failed',
          details: aiError instanceof Error ? aiError.message : 'Unknown AI error',
          fallback: {
            items: [],
            total_items: 0,
          },
        },
        { status: 422 }
      );
    }
  } catch (error) {
    console.error('[POST /api/ai/parse-inventory] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
