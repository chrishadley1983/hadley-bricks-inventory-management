import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { WorkflowService } from '@/lib/services/workflow.service';
import { z } from 'zod';

const CreateTaskSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  category: z.string().min(1).max(50).optional(),
  icon: z.string().max(10).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  estimatedMinutes: z.number().int().min(1).max(480).optional(),
  scheduledDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  presetId: z.string().uuid().optional(),
});

/**
 * POST /api/workflow/tasks
 * Create an ad-hoc task or from a preset
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const parsed = CreateTaskSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      presetId,
      name,
      description,
      category,
      icon,
      priority,
      estimatedMinutes,
      scheduledDate,
    } = parsed.data;

    const workflowService = new WorkflowService(supabase);

    if (presetId) {
      // Create from preset
      await workflowService.createFromPreset(user.id, presetId);
    } else if (name && category) {
      // Create ad-hoc task
      await workflowService.createAdHocTask(user.id, {
        name,
        description,
        category,
        icon,
        priority,
        estimatedMinutes,
        scheduledDate,
      });
    } else {
      return NextResponse.json(
        { error: 'Either presetId or name and category are required' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/workflow/tasks] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
