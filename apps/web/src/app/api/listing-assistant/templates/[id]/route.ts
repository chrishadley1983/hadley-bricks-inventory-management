/**
 * Single Template API Routes
 *
 * GET    /api/listing-assistant/templates/[id] - Get a template
 * PATCH  /api/listing-assistant/templates/[id] - Update a template
 * DELETE /api/listing-assistant/templates/[id] - Delete a template
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import {
  getTemplateById,
  updateTemplate,
  deleteTemplate,
} from '@/lib/listing-assistant/templates.service';

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  type: z.enum(['lego_used', 'lego_new', 'general', 'custom']).optional(),
  is_default: z.boolean().optional(),
});

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/listing-assistant/templates/[id]
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const template = await getTemplateById(user.id, id);

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ data: template });
  } catch (error) {
    console.error('[GET /api/listing-assistant/templates/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/listing-assistant/templates/[id]
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const parsed = UpdateTemplateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const template = await updateTemplate(user.id, id, parsed.data);

    return NextResponse.json({ data: template });
  } catch (error) {
    console.error('[PATCH /api/listing-assistant/templates/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/listing-assistant/templates/[id]
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    await deleteTemplate(user.id, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMessage = 'Internal server error';

    if (errorMessage.includes('Cannot delete default')) {
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    console.error('[DELETE /api/listing-assistant/templates/[id]] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
