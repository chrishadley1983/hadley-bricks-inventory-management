import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WorkflowService } from '@/lib/services/workflow.service';
import { z } from 'zod';
import type { TaskStatus } from '@hadley-bricks/database';

const UpdateTaskSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'skipped', 'deferred']),
  deferredToDate: z.string().optional(),
});

/**
 * PATCH /api/workflow/tasks/[id]
 * Update task status
 */
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
    const parsed = UpdateTaskSchema.safeParse(body);

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
