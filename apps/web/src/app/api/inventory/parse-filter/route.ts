import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { sendMessageForJSON } from '@/lib/ai/claude-client';
import {
  PARSE_INVENTORY_FILTER_SYSTEM_PROMPT,
  createParseFilterMessage,
  type ParsedInventoryFilterResponse,
} from '@/lib/ai/prompts/parse-inventory-filter';

const RequestSchema = z.object({
  query: z.string().min(1).max(500),
});

/**
 * POST /api/inventory/parse-filter
 * Parse a natural language query into inventory filters using AI
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
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { query } = parsed.data;
    const currentDate = new Date().toISOString().split('T')[0];

    const result = await sendMessageForJSON<ParsedInventoryFilterResponse>(
      PARSE_INVENTORY_FILTER_SYSTEM_PROMPT,
      createParseFilterMessage(query, currentDate),
      {
        model: 'claude-3-5-haiku-20241022', // Use Haiku for faster, cheaper responses
        maxTokens: 512,
        temperature: 0.1, // Low temperature for more deterministic parsing
      }
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('[POST /api/inventory/parse-filter] Error:', error);
    return NextResponse.json(
      { error: 'Failed to parse filter query' },
      { status: 500 }
    );
  }
}
