/**
 * API Route: /api/cost-modelling/scenarios
 * GET - List all scenarios for user
 * POST - Create new scenario
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { CostModellingRepository } from '@/lib/repositories/cost-modelling.repository';

const CreateScenarioSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
});

/**
 * GET /api/cost-modelling/scenarios
 * Returns list of scenarios for dropdown
 * F8: Creates default scenario if user has none
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

    const repository = new CostModellingRepository(supabase);
    const scenarios = await repository.findAllByUser(user.id);

    // F8: If no scenarios, create default
    if (scenarios.length === 0) {
      const defaultScenario = await repository.createDefault(user.id);
      return NextResponse.json({
        data: [
          {
            id: defaultScenario.id,
            name: defaultScenario.name,
            updated_at: defaultScenario.updated_at,
            is_default: defaultScenario.is_default,
          },
        ],
      });
    }

    return NextResponse.json({ data: scenarios });
  } catch (error) {
    console.error('[GET /api/cost-modelling/scenarios] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scenarios' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cost-modelling/scenarios
 * Creates a new scenario with default values
 * F3: Returns 201 with scenario ID
 */
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
    const parsed = CreateScenarioSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const repository = new CostModellingRepository(supabase);
    const scenario = await repository.create(user.id, {
      name: parsed.data.name,
      description: parsed.data.description,
    });

    return NextResponse.json({ data: scenario }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/cost-modelling/scenarios] Error:', error);

    // Handle unique constraint violation (duplicate name)
    if (error instanceof Error && error.message.includes('duplicate')) {
      return NextResponse.json(
        { error: 'A scenario with this name already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create scenario' },
      { status: 500 }
    );
  }
}
