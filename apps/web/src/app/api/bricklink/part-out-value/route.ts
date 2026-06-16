/**
 * BrickLink Part Out Value API.
 *
 *   GET  /api/bricklink/part-out-value?set=77075[&condition=N&breakType=M&incInstructions=true...]
 *        → cached row + staleness/age. Read-only; never scrapes.
 *
 *   POST /api/bricklink/part-out-value          { set, ...options, force? }
 *        → live scrape via the LOCAL Chrome (CDP :9222) + cache. Only works where Chrome is
 *          reachable (local dev server). On Vercel/CI it gracefully returns cache-only.
 *
 * Auth: cookie session via requireUser(). Runtime: nodejs (CDP/ws).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/api/require-user';
import {
  resolvePovOptions,
  parseSetNumber,
  scrapePov,
  isCdpReachable,
  isValidSetNumber,
  SET_NUMBER_RE,
  LoginRequiredError,
  CaptchaError,
  NotFoundError,
  EmptyResponseError,
  type PovOptions,
} from '@/lib/bricklink/part-out-value';
import { PartOutValueCacheService, buildPovCacheRow } from '@/lib/bricklink/part-out-value-cache.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bool = (v: string | null | undefined, d: boolean): boolean => {
  if (v == null) return d;
  return v === 'true' || v === '1' || v === 'Y' || v === 'y';
};

function optionsFrom(get: (k: string) => string | null | undefined, rawSet: string): PovOptions {
  const { itemNo, itemSeq } = parseSetNumber(rawSet);
  const seqParam = get('itemSeq');
  return resolvePovOptions({
    setNumber: itemNo,
    itemSeq: seqParam ? parseInt(seqParam, 10) || itemSeq : itemSeq,
    condition: get('condition') === 'U' ? 'U' : 'N',
    breakType: get('breakType') === 'B' ? 'B' : 'M',
    incInstructions: bool(get('incInstructions'), true),
    incBox: bool(get('incBox'), false),
    incExtra: bool(get('incExtra'), false),
    incBreak: bool(get('incBreak'), false),
  });
}

export async function GET(request: Request) {
  const { supabase, unauthorized } = await requireUser();
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const set = url.searchParams.get('set');
  if (!set) return NextResponse.json({ error: 'Missing required query param: set' }, { status: 400 });
  if (!isValidSetNumber(set)) return NextResponse.json({ error: 'Invalid set number' }, { status: 400 });

  const service = new PartOutValueCacheService(supabase);
  const opts = optionsFrom((k) => url.searchParams.get(k), set);
  const freshnessOverride = url.searchParams.get('freshnessDays');
  const cached = await service.getCached(opts, freshnessOverride ? parseInt(freshnessOverride, 10) : undefined);

  if (!cached) return NextResponse.json({ data: { found: false, options: opts } });
  return NextResponse.json({
    data: { found: true, isFresh: cached.isFresh, ageMs: cached.ageMs, row: cached.row, options: opts },
  });
}

const PostSchema = z.object({
  set: z.string().min(1).regex(SET_NUMBER_RE, 'Invalid set number'),
  itemSeq: z.number().int().positive().optional(),
  condition: z.enum(['N', 'U']).optional(),
  breakType: z.enum(['M', 'B']).optional(),
  incInstructions: z.boolean().optional(),
  incBox: z.boolean().optional(),
  incExtra: z.boolean().optional(),
  incBreak: z.boolean().optional(),
  force: z.boolean().optional(),
  cdpPort: z.number().int().optional(),
  usdRate: z.number().optional(),
});

export async function POST(request: Request) {
  const { supabase, unauthorized } = await requireUser();
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  const service = new PartOutValueCacheService(supabase);
  const config = await service.getConfig();
  const { itemNo, itemSeq } = parseSetNumber(b.set);
  const opts = resolvePovOptions({
    setNumber: itemNo,
    itemSeq: b.itemSeq ?? itemSeq,
    condition: b.condition ?? (config?.default_condition as 'N' | 'U') ?? 'N',
    breakType: b.breakType ?? (config?.default_break_type as 'M' | 'B') ?? 'M',
    incInstructions: b.incInstructions ?? config?.default_inc_instructions ?? true,
    incBox: b.incBox ?? config?.default_inc_box ?? false,
    incExtra: b.incExtra ?? config?.default_inc_extra ?? false,
    incBreak: b.incBreak ?? config?.default_inc_break ?? false,
  });
  const cdpPort = b.cdpPort ?? 9222;

  // Cache-first unless forced
  if (!b.force) {
    const cached = await service.getCached(opts, config?.freshness_days ?? undefined);
    if (cached?.isFresh) {
      return NextResponse.json({ data: { scraped: false, fromCache: true, isFresh: true, ageMs: cached.ageMs, row: cached.row } });
    }
  }

  // Live scrape requires the local Chrome — gracefully degrade where it isn't reachable.
  if (!(await isCdpReachable(cdpPort))) {
    const cached = await service.getCached(opts, config?.freshness_days ?? undefined);
    return NextResponse.json({
      data: {
        scraped: false,
        cdpReachable: false,
        note: 'Local Chrome (CDP) not reachable — live fetch only works on the local dev server. Returning cache.',
        row: cached?.row ?? null,
        isFresh: cached?.isFresh ?? false,
        ageMs: cached?.ageMs ?? null,
      },
    });
  }

  try {
    const result = await scrapePov(opts, { cdpPort });
    const usdRate = b.usdRate ?? (config?.usd_to_gbp_rate ? Number(config.usd_to_gbp_rate) : null);
    const retail = await service.getUkRetailGbp(itemNo, opts.itemSeq);
    const row = buildPovCacheRow(result, {
      usdToGbpRate: usdRate,
      ukRetailGbp: retail?.value ?? null,
      retailSource: retail?.source ?? null,
    });
    const stored = await service.upsert(row);
    return NextResponse.json({ data: { scraped: true, cdpReachable: true, row: stored } });
  } catch (e) {
    const status =
      e instanceof NotFoundError ? 404 : e instanceof LoginRequiredError || e instanceof CaptchaError || e instanceof EmptyResponseError ? 503 : 500;
    console.error('[POST /api/bricklink/part-out-value] scrape error:', (e as Error).message);
    return NextResponse.json({ error: (e as Error).message, code: (e as Error).name }, { status });
  }
}
