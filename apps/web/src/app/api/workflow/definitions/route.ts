/**
 * Task Definitions API
 *
 * GET: Fetch all task definitions for the user
 * POST: Create a new task definition
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const CreateDefinitionSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  category: z.string().min(1).max(50),
  icon: z.string().max(10).optional(),
  frequency: z.enum([
    'daily',
    'twice_daily',
    'twice_weekly',
    'weekly',
    'monthly',
    'quarterly',
    'biannual',
    'adhoc',
  ]),
  frequency_days: z.array(z.number().min(1).max(7)).optional(),
  ideal_time: z.enum(['AM', 'PM', 'ANY']).optional(),
  priority: z.number().min(1).max(4).optional(),
  estimated_minutes: z.number().min(1).optional(),
  deep_link_url: z.string().max(255).optional(),
  count_source: z.string().max(100).optional(),
  is_active: z.boolean().optional(),
});

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

    const { data: definitions, error } = await supabase
      .from('workflow_task_definitions')
      .select('*')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('[GET /api/workflow/definitions] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch definitions' }, { status: 500 });
    }

    return NextResponse.json({ definitions });
  } catch (error) {
    console.error('[GET /api/workflow/definitions] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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
    const parsed = CreateDefinitionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { data: definition, error } = await supabase
      .from('workflow_task_definitions')
      .insert({
        user_id: user.id,
        name: parsed.data.name,
        description: parsed.data.description || null,
        category: parsed.data.category,
        icon: parsed.data.icon || null,
        frequency: parsed.data.frequency,
        frequency_days: parsed.data.frequency_days || null,
        ideal_time: parsed.data.ideal_time || 'ANY',
        priority: parsed.data.priority || 3,
        estimated_minutes: parsed.data.estimated_minutes || null,
        deep_link_url: parsed.data.deep_link_url || null,
        count_source: parsed.data.count_source || null,
        is_active: parsed.data.is_active ?? true,
        task_type: 'system',
        is_system: false,
      })
      .select()
      .single();

    if (error) {
      console.error('[POST /api/workflow/definitions] Error:', error);
      return NextResponse.json({ error: 'Failed to create definition' }, { status: 500 });
    }

    return NextResponse.json({ definition }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/workflow/definitions] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
