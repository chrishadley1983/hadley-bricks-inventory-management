import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { WorkflowService } from '@/lib/services/workflow.service';

/**
 * GET /api/workflow/presets
 * Get off-system task presets
 */
export async function GET(_request: NextRequest) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

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
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
