/**
 * Templates API Routes
 *
 * GET  /api/listing-assistant/templates - Get all templates
 * POST /api/listing-assistant/templates - Create a new template
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createTemplate, ensureTemplates } from '@/lib/listing-assistant/templates.service';

const CreateTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  content: z.string().min(1, 'Content is required'),
  type: z.enum(['lego_used', 'lego_new', 'general', 'custom']),
  is_default: z.boolean().optional(),
});

/**
 * GET /api/listing-assistant/templates
 * Get all templates for the current user, seeding defaults if needed
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure templates exist (seeds defaults if needed)
    const templates = await ensureTemplates(user.id);

    return NextResponse.json({ data: templates });
  } catch (error) {
    console.error('[GET /api/listing-assistant/templates] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/listing-assistant/templates
 * Create a new template
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
    const parsed = CreateTemplateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const template = await createTemplate(user.id, parsed.data);

    return NextResponse.json({ data: template }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/listing-assistant/templates] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
