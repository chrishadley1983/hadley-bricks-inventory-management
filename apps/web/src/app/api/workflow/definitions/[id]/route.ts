/**
 * Task Definition by ID API
 *
 * GET: Fetch a single task definition
 * PATCH: Update a task definition
 * DELETE: Delete a task definition
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const UpdateDefinitionSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  category: z.string().min(1).max(50).optional(),
  icon: z.string().max(10).nullable().optional(),
  frequency: z
    .enum([
      'daily',
      'twice_daily',
      'twice_weekly',
      'weekly',
      'monthly',
      'quarterly',
      'biannual',
      'adhoc',
    ])
    .optional(),
  frequency_days: z.array(z.number().min(1).max(7)).nullable().optional(),
  ideal_time: z.enum(['AM', 'PM', 'ANY']).optional(),
  priority: z.number().min(1).max(4).optional(),
  estimated_minutes: z.number().min(1).nullable().optional(),
  deep_link_url: z.string().max(255).nullable().optional(),
  count_source: z.string().max(100).nullable().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: definition, error } = await supabase
      .from('workflow_task_definitions')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !definition) {
      return NextResponse.json({ error: 'Definition not found' }, { status: 404 });
    }

    return NextResponse.json({ definition });
  } catch (error) {
    console.error('[GET /api/workflow/definitions/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = UpdateDefinitionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Check if definition exists and belongs to user
    const { data: existing, error: fetchError } = await supabase
      .from('workflow_task_definitions')
      .select('id, is_system')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Definition not found' }, { status: 404 });
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.category !== undefined) updateData.category = parsed.data.category;
    if (parsed.data.icon !== undefined) updateData.icon = parsed.data.icon;
    if (parsed.data.frequency !== undefined) updateData.frequency = parsed.data.frequency;
    if (parsed.data.frequency_days !== undefined) updateData.frequency_days = parsed.data.frequency_days;
    if (parsed.data.ideal_time !== undefined) updateData.ideal_time = parsed.data.ideal_time;
    if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;
    if (parsed.data.estimated_minutes !== undefined) updateData.estimated_minutes = parsed.data.estimated_minutes;
    if (parsed.data.deep_link_url !== undefined) updateData.deep_link_url = parsed.data.deep_link_url;
    if (parsed.data.count_source !== undefined) updateData.count_source = parsed.data.count_source;
    if (parsed.data.is_active !== undefined) updateData.is_active = parsed.data.is_active;
    if (parsed.data.sort_order !== undefined) updateData.sort_order = parsed.data.sort_order;

    const { data: definition, error } = await supabase
      .from('workflow_task_definitions')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('[PATCH /api/workflow/definitions/[id]] Error:', error);
      return NextResponse.json({ error: 'Failed to update definition' }, { status: 500 });
    }

    return NextResponse.json({ definition });
  } catch (error) {
    console.error('[PATCH /api/workflow/definitions/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if definition exists and belongs to user
    const { data: existing, error: fetchError } = await supabase
      .from('workflow_task_definitions')
      .select('id, is_system')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Definition not found' }, { status: 404 });
    }

    // System tasks can be disabled but not deleted
    if (existing.is_system) {
      return NextResponse.json(
        { error: 'System tasks cannot be deleted. Disable them instead.' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('workflow_task_definitions')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      console.error('[DELETE /api/workflow/definitions/[id]] Error:', error);
      return NextResponse.json({ error: 'Failed to delete definition' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/workflow/definitions/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
