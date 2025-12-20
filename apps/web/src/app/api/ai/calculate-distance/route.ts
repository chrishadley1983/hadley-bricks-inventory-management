import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  sendMessageForJSON,
  CALCULATE_DISTANCE_SYSTEM_PROMPT,
  createCalculateDistanceMessage,
  type DistanceResponse,
} from '@/lib/ai';

const RequestSchema = z.object({
  fromPostcode: z.string().min(2, 'From postcode is required'),
  toPostcode: z.string().min(2, 'To postcode is required'),
});

/**
 * POST /api/ai/calculate-distance
 * Calculate driving distance between two UK postcodes using Claude
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

    const { fromPostcode, toPostcode } = parsed.data;

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

    // Call Claude to estimate the distance
    try {
      const result = await sendMessageForJSON<DistanceResponse>(
        CALCULATE_DISTANCE_SYSTEM_PROMPT,
        createCalculateDistanceMessage(fromPostcode, toPostcode),
        { temperature: 0.2 }
      );

      return NextResponse.json({
        data: {
          distance: result.distance_miles,
          roundTrip: result.round_trip_miles,
          fromPostcode: result.from_postcode,
          toPostcode: result.to_postcode,
          estimated: result.estimated,
          explanation: result.explanation,
        },
      });
    } catch (aiError) {
      console.error('[POST /api/ai/calculate-distance] AI Error:', aiError);

      return NextResponse.json(
        {
          error: 'Distance calculation failed',
          details:
            aiError instanceof Error ? aiError.message : 'Unknown AI error',
        },
        { status: 422 }
      );
    }
  } catch (error) {
    console.error('[POST /api/ai/calculate-distance] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
