/**
 * Record REAL landed-cost actuals from a calibration order into
 * bl_import_zone_costs (intl-set-arb F5).
 *
 * After a real consignment arrives, run with the observed numbers; the zone's
 * bands are re-derived and calibrated_at is stamped, which clears the
 * UNCALIBRATED flag for future flagger runs (existing candidates re-flag on the
 * next nightly refresh).
 *
 *   npx tsx scripts/intl-arb/record-zone-actuals.ts --zone=ASIA \
 *     --order-total-gbp=180.50 --shipping-gbp=34.00 --weight-g=2450 \
 *     --handling-gbp=8.00 --vat-charged-gbp=44.20 --duty-charged-gbp=8.60 \
 *     [--notes="RM/DHL, seller X, 6 sets"]
 *
 * Band derivation: ship_per_100g = shipping / (weight/100) with ship_base kept
 * unless --ship-base-gbp given. VAT/duty recorded as observed effective rates.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
import { createClient } from '@supabase/supabase-js';

const argv = process.argv.slice(2).reduce<Record<string, string>>((a, s) => {
  const [k, v] = s.replace(/^--/, '').split('='); a[k] = v ?? 'true'; return a;
}, {});

const need = (k: string): number => {
  const v = parseFloat(argv[k] ?? '');
  if (!Number.isFinite(v)) { console.error(`--${k}=<number> is required`); process.exit(1); }
  return v;
};

const ZONE = argv['zone'];
if (!ZONE) { console.error('--zone=EU|US_CA|ASIA|ROW is required'); process.exit(1); }

const orderTotal = need('order-total-gbp');
const shipping = need('shipping-gbp');
const weightG = need('weight-g');
const handling = need('handling-gbp');
const vatCharged = need('vat-charged-gbp');
const dutyCharged = need('duty-charged-gbp');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

(async () => {
  const dutiable = orderTotal + shipping;
  const dutyRate = +(dutyCharged / dutiable).toFixed(4);
  const vatRate = +(vatCharged / (dutiable + dutyCharged)).toFixed(4);
  const shipPer100g = +((shipping - (parseFloat(argv['ship-base-gbp'] ?? '') || 0)) / (weightG / 100)).toFixed(4);
  const update: Record<string, unknown> = {
    duty_rate: dutyRate,
    vat_rate: vatRate,
    handling_fee_gbp: handling,
    ship_per_100g_gbp: shipPer100g,
    calibrated_at: new Date().toISOString(),
    notes: argv['notes'] ?? `calibrated from real order: total £${orderTotal}, ship £${shipping}, ${weightG}g`,
    updated_at: new Date().toISOString(),
  };
  if (argv['ship-base-gbp']) update.ship_base_gbp = parseFloat(argv['ship-base-gbp']);
  const { data, error } = await supabase.from('bl_import_zone_costs').update(update).eq('zone', ZONE).select();
  if (error) throw new Error(error.message);
  if (!data?.length) { console.error(`zone ${ZONE} not found`); process.exit(1); }
  console.log(`[record-zone-actuals] ${ZONE} calibrated: duty ${(100 * dutyRate).toFixed(1)}%, vat ${(100 * vatRate).toFixed(1)}%, ship £${shipPer100g}/100g, handling £${handling}`);
  console.log('[record-zone-actuals] candidates pick up the new bands on the next nightly refresh (or run refresh-candidates.ts now).');
})().catch((e) => { console.error(e); process.exit(1); });
