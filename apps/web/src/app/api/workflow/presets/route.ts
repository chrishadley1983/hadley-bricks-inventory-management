import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WorkflowService } from '@/lib/services/workflow.service';

/**
 * GET /api/workflow/presets
 * Get off-system task presets
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

    // Ensure presets are seeded
    const { data: hasPresets } = await supabase
      .from('off_system_task_presets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (!hasPresets) {
      // Seed data if not exists
      await supabase.rpc('seed_workflow_data', { p_user_id: user.id });
    }

    const presets = await workflowService.getPresets(user.id);

    return NextResponse.json({ presets });
  } catch (error) {
    console.error('[GET /api/workflow/presets] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
