import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Future custom task instance
 */
export interface FutureTask {
  id: string;
  name: string;
  description: string | null;
  category: string;
  priority: number;
  estimatedMinutes: number | null;
  scheduledDate: string;
  status: string;
  createdAt: string;
}

/**
 * GET /api/workflow/tasks/future
 * Fetch future custom tasks (off_system tasks scheduled for future dates)
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

    const today = new Date().toISOString().split('T')[0];

    // Fetch future off_system tasks that are pending
    const { data: tasks, error } = await supabase
      .from('workflow_task_instances')
      .select('*')
      .eq('user_id', user.id)
      .eq('task_type', 'off_system')
      .eq('status', 'pending')
      .gt('scheduled_date', today)
      .is('task_definition_id', null)
      .order('scheduled_date', { ascending: true });

    if (error) {
      console.error('[GET /api/workflow/tasks/future] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const futureTasks: FutureTask[] = (tasks ?? []).map((task) => ({
      id: task.id,
      name: task.name ?? 'Unknown Task',
      description: task.description,
      category: task.category ?? 'Other',
      priority: task.priority ?? 3,
      estimatedMinutes: task.estimated_minutes,
      scheduledDate: task.scheduled_date,
      status: task.status ?? 'pending',
      createdAt: task.created_at ?? new Date().toISOString(),
    }));

    return NextResponse.json({ tasks: futureTasks });
  } catch (error) {
    console.error('[GET /api/workflow/tasks/future] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
