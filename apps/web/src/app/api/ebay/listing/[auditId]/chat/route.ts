/**
 * Listing Improvement Chat API
 *
 * POST /api/ebay/listing/[auditId]/chat
 *
 * Handles chat messages for discussing listing improvements.
 * Uses Claude to provide suggestions based on listing context and quality review.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { sendConversation, type ChatMessage } from '@/lib/ai';
import {
  createListingImprovementSystemPrompt,
  type ListingChatContext,
} from '@/lib/ai/prompts/listing-improvement-chat';
import type { QualityReviewResult } from '@/lib/ebay/listing-creation.types';

/**
 * Request schema for chat endpoint
 */
const ChatRequestSchema = z.object({
  message: z.string().min(1, 'Message is required').max(2000, 'Message too long'),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })
    )
    .max(20, 'Conversation history too long'),
});

/**
 * Response type for chat endpoint
 */
export interface ChatResponse {
  response: string;
  error?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
): Promise<NextResponse<ChatResponse>> {
  try {
    const { auditId } = await params;

    // Validate auditId
    if (!auditId || auditId.length < 10) {
      return NextResponse.json({ response: '', error: 'Invalid audit ID' }, { status: 400 });
    }

    // Create authenticated client
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ response: '', error: 'Unauthorized' }, { status: 401 });
    }

    // Validate request body
    const body = await request.json();
    const parsed = ChatRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          response: '',
          error: parsed.error.flatten().fieldErrors.message?.[0] || 'Invalid request',
        },
        { status: 400 }
      );
    }

    const { message, conversationHistory } = parsed.data;

    // Fetch the audit record to get listing context
    const { data: audit, error: fetchError } = await supabase
      .from('listing_creation_audit')
      .select(
        `
        id,
        generated_title,
        generated_description,
        item_specifics,
        quality_score,
        quality_feedback,
        listing_price,
        description_style
      `
      )
      .eq('id', auditId)
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json(
          { response: '', error: 'Audit record not found' },
          { status: 404 }
        );
      }
      console.error('[POST /api/ebay/listing/chat] Fetch error:', fetchError);
      return NextResponse.json(
        { response: '', error: 'Failed to fetch audit record' },
        { status: 500 }
      );
    }

    // Validate that we have quality feedback
    if (!audit.quality_feedback || !audit.generated_title) {
      return NextResponse.json(
        { response: '', error: 'Listing quality review is not complete' },
        { status: 400 }
      );
    }

    // Check if API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { response: '', error: 'AI service not configured' },
        { status: 503 }
      );
    }

    // Build the context for the chat
    const context: ListingChatContext = {
      title: audit.generated_title,
      description: audit.generated_description || '',
      itemSpecifics: (audit.item_specifics as Record<string, string>) || {},
      qualityScore: audit.quality_score || 0,
      qualityFeedback: audit.quality_feedback as unknown as QualityReviewResult,
      listingPrice: audit.listing_price ? Number(audit.listing_price) : null,
      descriptionStyle: audit.description_style,
    };

    // Create system prompt
    const systemPrompt = createListingImprovementSystemPrompt(context);

    // Build messages array for Claude
    const messages: ChatMessage[] = [...conversationHistory, { role: 'user', content: message }];

    // Call Claude
    try {
      const response = await sendConversation(systemPrompt, messages, {
        maxTokens: 1024,
        temperature: 0.5,
      });

      return NextResponse.json({ response });
    } catch (aiError) {
      console.error('[POST /api/ebay/listing/chat] AI error:', aiError);
      return NextResponse.json(
        { response: '', error: 'Failed to generate response. Please try again.' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[POST /api/ebay/listing/chat] Error:', error);
    return NextResponse.json({ response: '', error: 'Internal server error' }, { status: 500 });
  }
}
