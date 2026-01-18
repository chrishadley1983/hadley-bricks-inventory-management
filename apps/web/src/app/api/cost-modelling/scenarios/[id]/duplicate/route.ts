/**
 * API Route: /api/cost-modelling/scenarios/[id]/duplicate
 * POST - Duplicate a scenario
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CostModellingRepository } from '@/lib/repositories/cost-modelling.repository';

/**
 * POST /api/cost-modelling/scenarios/[id]/duplicate
 * Creates a copy of the scenario with "Copy of [name]"
 * F44: Returns new scenario
 */
export async function POST(
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

    const repository = new CostModellingRepository(supabase);
    const duplicate = await repository.duplicate(id, user.id);

    return NextResponse.json({ data: duplicate }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/cost-modelling/scenarios/[id]/duplicate] Error:', error);

    if (error instanceof Error && error.message === 'Scenario not found') {
      return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
    }

    if (error instanceof Error && error.message.includes('duplicate')) {
      return NextResponse.json(
        { error: 'A scenario with this name already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to duplicate scenario' },
      { status: 500 }
    );
  }
}
