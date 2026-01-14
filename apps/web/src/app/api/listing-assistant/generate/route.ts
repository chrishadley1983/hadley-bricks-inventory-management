/**
 * Generate Listing API Route
 *
 * POST /api/listing-assistant/generate - Generate an eBay listing using AI
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getTemplateById } from '@/lib/listing-assistant/templates.service';
import { getEbaySoldPrices } from '@/lib/listing-assistant/ebay-finding.service';
import {
  generateListing,
  analyzeProductImage,
} from '@/lib/listing-assistant/ai-service';
import type { GenerateListingResponse } from '@/lib/listing-assistant/types';

const GenerateListingSchema = z.object({
  item: z.string().min(1, 'Item name is required'),
  condition: z.enum(['New', 'Used']),
  keyPoints: z.string().default(''),
  templateId: z.string().uuid(),
  tone: z.enum(['Standard', 'Professional', 'Enthusiastic', 'Friendly', 'Minimalist']),
  imageBase64: z.string().optional(),
  inventoryItemId: z.string().uuid().optional(),
});

/**
 * POST /api/listing-assistant/generate
 * Generate an eBay listing using Claude Opus
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
    const parsed = GenerateListingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { item, condition, keyPoints, templateId, tone, imageBase64 } = parsed.data;

    // 1. Fetch the template
    const template = await getTemplateById(user.id, templateId);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // 2. Get eBay sold prices
    console.log('[Generate] Fetching eBay sold prices for:', item);
    const { items: ebaySoldItems } = await getEbaySoldPrices(item, condition);

    // 3. Analyze image if provided
    let imageAnalysis = undefined;
    if (imageBase64) {
      console.log('[Generate] Analyzing image with Gemini...');
      imageAnalysis = await analyzeProductImage(imageBase64);
    }

    // 4. Generate listing with Claude Opus
    console.log('[Generate] Generating listing with Claude Opus...');
    const result = await generateListing(
      item,
      condition,
      keyPoints,
      template.content,
      tone,
      ebaySoldItems,
      imageAnalysis
    );

    const response: GenerateListingResponse = {
      title: result.title,
      priceRange: result.priceRange,
      description: result.description,
      ebaySoldItems: ebaySoldItems,
      imageAnalysis,
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error('[POST /api/listing-assistant/generate] Error:', error);

    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.message.includes('ANTHROPIC_API_KEY')) {
        return NextResponse.json(
          { error: 'AI service not configured. Please check API keys.' },
          { status: 500 }
        );
      }
      if (error.message.includes('rate limit')) {
        return NextResponse.json(
          { error: 'AI service rate limited. Please try again in a moment.' },
          { status: 429 }
        );
      }
    }

    return NextResponse.json({ error: 'Failed to generate listing' }, { status: 500 });
  }
}
