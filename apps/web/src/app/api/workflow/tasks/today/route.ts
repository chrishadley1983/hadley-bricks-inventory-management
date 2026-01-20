import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WorkflowService } from '@/lib/services/workflow.service';

/**
 * GET /api/workflow/tasks/today
 * Get today's task queue with dynamic counts
 */
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const workflowService = new WorkflowService(supabase);
    const result = await workflowService.getTodaysTasks(user.id);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[GET /api/workflow/tasks/today] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
