/**
 * GET /api/bricklink/partout/estimate?setNumber=XXX
 *
 * What a full part-out run would cost in BrickLink calls, without running it. The
 * single-screen Set Lookup shows this before offering the Run button, so an expensive
 * run is a decision rather than a side effect of looking a set up.
 *
 * Costs one BrickLink call itself (getSubsets).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { BrickLinkClient } from '@/lib/bricklink';
import type { BrickLinkCredentials } from '@/lib/bricklink';
import { CredentialsRepository } from '@/lib/repositories';
import { PartoutService } from '@/lib/bricklink/partout.service';
import { mapPartoutError } from '@/lib/bricklink/partout-error';

const QuerySchema = z.object({ setNumber: z.string().min(1, 'Set number is required') });

export async function GET(request: NextRequest) {
  try {
    const { user, supabase, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({ setNumber: searchParams.get('setNumber') });
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const credentials = await new CredentialsRepository(supabase).getCredentials<BrickLinkCredentials>(
      user.id,
      'bricklink'
    );
    if (!credentials) {
      return NextResponse.json(
        { error: 'BrickLink not configured. Please configure BrickLink credentials in Settings.' },
        { status: 400 }
      );
    }

    const service = new PartoutService(
      new BrickLinkClient(credentials, { supabase, caller: 'partout-estimate' }),
      supabase
    );
    const data = await service.estimatePartoutCost(parsed.data.setNumber);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('[GET /api/bricklink/partout/estimate] Error:', error);
    const { status, message } = mapPartoutError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
