import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WorkflowService } from '@/lib/services/workflow.service';
import { z } from 'zod';
import type { TaskStatus } from '@hadley-bricks/database';

const UpdateStatusSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'skipped', 'deferred']),
  deferredToDate: z.string().optional(),
});

const UpdateTaskSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional().nullable(),
  category: z.string().min(1).max(50).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  estimatedMinutes: z.number().int().min(1).max(480).optional().nullable(),
  scheduledDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * PATCH /api/workflow/tasks/[id]
 * Update task status
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const parsed = UpdateStatusSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { status, deferredToDate } = parsed.data;

    // Verify task belongs to user
    const { data: task, error: taskError } = await supabase
      .from('workflow_task_instances')
      .select('user_id')
      .eq('id', id)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const workflowService = new WorkflowService(supabase);
    await workflowService.updateTaskStatus(id, status as TaskStatus, { deferredToDate });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/workflow/tasks/[id]] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/workflow/tasks/[id]
 * Update task details (for future custom tasks)
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const parsed = UpdateTaskSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Verify task belongs to user and is an off_system task
    const { data: task, error: taskError } = await supabase
      .from('workflow_task_instances')
      .select('user_id, task_type, task_definition_id')
      .eq('id', id)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (task.task_type !== 'off_system' || task.task_definition_id !== null) {
      return NextResponse.json({ error: 'Can only edit custom ad-hoc tasks' }, { status: 400 });
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.category !== undefined) updateData.category = parsed.data.category;
    if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;
    if (parsed.data.estimatedMinutes !== undefined)
      updateData.estimated_minutes = parsed.data.estimatedMinutes;
    if (parsed.data.scheduledDate !== undefined)
      updateData.scheduled_date = parsed.data.scheduledDate;

    const { error: updateError } = await supabase
      .from('workflow_task_instances')
      .update(updateData)
      .eq('id', id);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PUT /api/workflow/tasks/[id]] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workflow/tasks/[id]
 * Delete a custom ad-hoc task
 */
export async function DELETE(
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

    // Verify task belongs to user and is an off_system task without a definition
    const { data: task, error: taskError } = await supabase
      .from('workflow_task_instances')
      .select('user_id, task_type, task_definition_id')
      .eq('id', id)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (task.task_type !== 'off_system' || task.task_definition_id !== null) {
      return NextResponse.json({ error: 'Can only delete custom ad-hoc tasks' }, { status: 400 });
    }

    const { error: deleteError } = await supabase
      .from('workflow_task_instances')
      .delete()
      .eq('id', id);

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/workflow/tasks/[id]] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
