/**
 * pov-fetch — fetch a BrickLink Part Out Value for one set, cache-first.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/pov-fetch.ts --set=77075
 *   npx tsx scripts/pov-fetch.ts --set=77075-1 --condition=U --no-instructions --force
 *   npx tsx scripts/pov-fetch.ts --set=77075 --logged-out --usd-rate=0.74
 *
 * Cache-first: returns a fresh cached row without scraping. --force re-scrapes.
 * Logged-in scrape returns GBP; --logged-out (incognito) returns USD → converted via --usd-rate
 * (or config.usd_to_gbp_rate). Rate-limit discipline: one navigation per uncached set, stops on
 * login/captcha (typed errors), never loops.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { z } from 'zod';
import {
  resolvePovOptions,
  parseSetNumber,
  scrapePov,
  SET_NUMBER_RE,
  LoginRequiredError,
  CaptchaError,
  NotFoundError,
  type PovOptions,
} from '../src/lib/bricklink/part-out-value';
import {
  PartOutValueCacheService,
  buildPovCacheRow,
} from '../src/lib/bricklink/part-out-value-cache.service';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const argv = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? 'true';
  return acc;
}, {});

const ArgSchema = z.object({
  set: z.string().min(1, '--set is required').regex(SET_NUMBER_RE, '--set is not a valid set number'),
  condition: z.enum(['N', 'U']).optional(),
  'break-type': z.enum(['M', 'B']).optional(),
  instructions: z.enum(['true', 'false']).optional(),
  'no-instructions': z.string().optional(),
  'inc-box': z.string().optional(),
  'inc-extra': z.string().optional(),
  'inc-break': z.string().optional(),
  'logged-out': z.string().optional(),
  force: z.string().optional(),
  'cdp-port': z.string().optional(),
  'usd-rate': z.string().optional(),
  freshness: z.string().optional(),
});

const parsed = ArgSchema.safeParse(argv);
if (!parsed.success) {
  console.error('Invalid args:', parsed.error.issues.map((i) => i.message).join('; '));
  process.exit(1);
}
const args = parsed.data;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);
const service = new PartOutValueCacheService(supabase);

const fmtMoney = (v: number | null | undefined, ccy: string | null) => {
  if (v == null) return 'n/a';
  const sym = ccy === 'GBP' ? '£' : ccy === 'USD' ? '$' : `${ccy ?? ''} `;
  return `${sym}${Number(v).toFixed(2)}`;
};
const fmtAge = (ms: number) => {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

async function main() {
  const { itemNo, itemSeq } = parseSetNumber(args.set);
  const config = await service.getConfig();
  const force = args.force === 'true' || args.force === '';
  const loggedOut = args['logged-out'] === 'true' || args['logged-out'] === '';
  const cdpPort = args['cdp-port'] ? parseInt(args['cdp-port'], 10) : 9225;
  const freshnessDays = args.freshness ? parseInt(args.freshness, 10) : config?.freshness_days ?? undefined;

  const incInstructions =
    args['no-instructions'] !== undefined
      ? false
      : args.instructions !== undefined
        ? args.instructions === 'true'
        : config?.default_inc_instructions ?? true;

  const opts: PovOptions = resolvePovOptions({
    setNumber: itemNo,
    itemSeq,
    condition: (args.condition as 'N' | 'U') ?? (config?.default_condition as 'N' | 'U') ?? 'N',
    breakType: (args['break-type'] as 'M' | 'B') ?? (config?.default_break_type as 'M' | 'B') ?? 'M',
    incInstructions,
    incBox: args['inc-box'] !== undefined ? args['inc-box'] !== 'false' : config?.default_inc_box ?? false,
    incExtra: args['inc-extra'] !== undefined ? args['inc-extra'] !== 'false' : config?.default_inc_extra ?? false,
    incBreak: args['inc-break'] !== undefined ? args['inc-break'] !== 'false' : config?.default_inc_break ?? false,
  });

  // Cache-first
  if (!force) {
    const cached = await service.getCached(opts, freshnessDays);
    if (cached && cached.isFresh) {
      printRow(cached.row, `cache hit (fetched ${fmtAge(cached.ageMs)} ago, no BL hit)`);
      return;
    }
  }

  // Scrape
  console.log(`[pov-fetch] scraping ${itemNo}-${itemSeq} (${loggedOut ? 'logged-out/USD' : 'logged-in/GBP'})…`);
  let result;
  try {
    result = await scrapePov(opts, { cdpPort, loggedOut });
  } catch (e) {
    if (e instanceof LoginRequiredError) console.error(`[pov-fetch] LOGIN REQUIRED — ${e.message}`);
    else if (e instanceof CaptchaError) console.error(`[pov-fetch] CAPTCHA — stop and back off. ${e.message}`);
    else if (e instanceof NotFoundError) console.error(`[pov-fetch] NOT FOUND — ${e.message}`);
    else console.error(`[pov-fetch] scrape error:`, (e as Error).message);
    process.exit(2);
  }

  const usdRate = args['usd-rate']
    ? parseFloat(args['usd-rate'])
    : config?.usd_to_gbp_rate
      ? Number(config.usd_to_gbp_rate)
      : null;
  if (result.nativeCurrency === 'USD' && !usdRate) {
    console.warn('[pov-fetch] currency is USD but no --usd-rate / config rate — GBP + multiple will be null');
  }

  const retail = await service.getUkRetailGbp(itemNo, itemSeq);
  const row = buildPovCacheRow(result, {
    usdToGbpRate: usdRate,
    ukRetailGbp: retail?.value ?? null,
    retailSource: retail?.source ?? null,
  });
  const stored = await service.upsert(row);
  if (!stored) {
    console.error('[pov-fetch] upsert failed');
    process.exit(3);
  }
  printRow(stored, 'cache miss → scraped + cached');
}

function printRow(row: Record<string, unknown>, note: string) {
  const ccy = (row.native_currency as string) ?? null;
  const soldNative = row.sold_6mo_native as number | null;
  const soldGbp = row.sold_6mo_avg_gbp as number | null;
  const forSaleNative = row.for_sale_native as number | null;
  const rrp = row.uk_retail_gbp as number | null;
  const mult = row.partout_multiple as number | null;
  console.log('');
  console.log(`  ${row.set_name ?? row.set_number}`);
  console.log(
    `  Sold avg (6mo) : ${fmtMoney(soldNative, ccy)}` +
      (ccy !== 'GBP' && soldGbp != null ? ` (≈ £${Number(soldGbp).toFixed(2)})` : '') +
      `  (${row.sold_6mo_items ?? '?'} items / ${row.sold_6mo_lots ?? '?'} lots)`,
  );
  console.log(`  For-sale avg   : ${fmtMoney(forSaleNative, ccy)}`);
  console.log(`  UK RRP (Brickset): ${rrp != null ? `£${Number(rrp).toFixed(2)}` : 'n/a (no RRP cached)'}`);
  console.log(
    `  Part Out       : ${mult != null ? `${Number(mult).toFixed(2)}× retail` : 'n/a (needs RRP + GBP)'}`,
  );
  console.log(`  cache: ${note}`);
  console.log('');
}

main().catch((e) => {
  console.error('[pov-fetch] fatal:', e);
  process.exit(1);
});
