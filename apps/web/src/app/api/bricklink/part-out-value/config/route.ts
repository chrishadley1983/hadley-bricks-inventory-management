/**
 * POV config — read / update the single-row defaults (condition, includes, freshness, backfill).
 *
 *   GET /api/bricklink/part-out-value/config        → { data: config }
 *   PUT /api/bricklink/part-out-value/config  {...}  → { data: updatedConfig }
 *
 * Auth: cookie session via requireUser().
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import { PartOutValueCacheService } from '@/lib/bricklink/part-out-value-cache.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { supabase, unauthorized } = await requireUser();
  if (unauthorized) return unauthorized;
  const service = new PartOutValueCacheService(supabase);
  const config = await service.getConfig();
  return NextResponse.json({ data: config });
}

const PutSchema = z
  .object({
    default_condition: z.enum(['N', 'U']),
    default_break_type: z.enum(['M', 'B']),
    default_inc_instructions: z.boolean(),
    default_inc_box: z.boolean(),
    default_inc_extra: z.boolean(),
    default_inc_break: z.boolean(),
    freshness_days: z.number().int().min(1).max(365),
    backfill_delay_ms: z.number().int().min(3000).max(120000),
    backfill_batch_size: z.number().int().min(1).max(1000),
    usd_to_gbp_rate: z.number().positive().nullable(),
  })
  .partial();

export async function PUT(request: Request) {
  const { supabase, unauthorized } = await requireUser();
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const service = new PartOutValueCacheService(supabase);
  const updated = await service.updateConfig(parsed.data);
  if (!updated) return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  return NextResponse.json({ data: updated });
}
