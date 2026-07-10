/**
 * Build/refresh bricklink_colour_map (unified-price-cache F1).
 * BL getColors() (canonical) LEFT JOIN Bricqer snapshot colours (by normalised name).
 *
 *   cd apps/web && npx tsx scripts/pg/build-colour-map.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { BrickLinkClient } from '../../src/lib/bricklink/client';
import { normColourName } from '../../src/lib/bricklink/colour-map';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const creds = {
    consumerKey: process.env.BRICKLINK_CONSUMER_KEY!,
    consumerSecret: process.env.BRICKLINK_CONSUMER_SECRET!,
    tokenValue: process.env.BRICKLINK_TOKEN_VALUE!,
    tokenSecret: process.env.BRICKLINK_TOKEN_SECRET!,
  };
  const bl = new BrickLinkClient(creds as any, { supabase, caller: 'build-colour-map' } as any);

  // 1. BL canonical colours
  const blColours = await bl.getColors();
  console.log(`BL colours: ${blColours.length}`);

  // 2. Bricqer colours from snapshot (distinct id+name)
  const bricqer = new Map<number, string>(); // id -> name
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('bricqer_inventory_snapshot')
      .select('color_id,color_name')
      .not('color_name', 'is', null)
      .order('color_id')
      .range(from, from + 999);
    if (error) throw error;
    for (const r of (data ?? []) as { color_id: number; color_name: string }[]) {
      if (r.color_id != null && r.color_name && !bricqer.has(r.color_id)) bricqer.set(r.color_id, r.color_name);
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`Bricqer colours: ${bricqer.size}`);

  // name -> bricqer {id,name}
  const bricqerByName = new Map<string, { id: number; name: string }>();
  for (const [id, name] of bricqer) {
    const k = normColourName(name);
    if (!bricqerByName.has(k)) bricqerByName.set(k, { id, name });
  }

  // 3. rows: every BL colour, with bricqer match by name
  const matchedBricqer = new Set<number>();
  const rows = blColours.map((c) => {
    const m = bricqerByName.get(normColourName(c.color_name));
    if (m) matchedBricqer.add(m.id);
    return {
      bl_colour_id: c.color_id,
      bl_colour_name: c.color_name,
      bricqer_colour_id: m?.id ?? null,
      bricqer_colour_name: m?.name ?? null,
      rgb: (c as any).color_code ? `#${(c as any).color_code}` : null,
      updated_at: new Date().toISOString(),
    };
  });

  // 3b. Ensure the "(Not Applicable)" / no-colour alias: BL 0 <-> Bricqer 1 (minifigs, sets, parts w/o colour)
  if (!rows.some((r) => r.bl_colour_id === 0)) {
    const naBricqer = [...bricqer.entries()].find(([, name]) => normColourName(name) === '(not applicable)');
    rows.push({
      bl_colour_id: 0,
      bl_colour_name: '(Not Applicable)',
      bricqer_colour_id: naBricqer?.[0] ?? null,
      bricqer_colour_name: naBricqer?.[1] ?? '(Not Applicable)',
      rgb: null,
      updated_at: new Date().toISOString(),
    });
    if (naBricqer) matchedBricqer.add(naBricqer[0]);
  }

  // 4. upsert
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('bricklink_colour_map').upsert(rows.slice(i, i + CHUNK), { onConflict: 'bl_colour_id' });
    if (error) throw error;
  }

  // 5. report unmatched Bricqer colours (present in our inventory but no BL name match)
  const unmatched = [...bricqer.entries()].filter(([id]) => !matchedBricqer.has(id));
  console.log(`Upserted ${rows.length} BL colours; Bricqer matched ${matchedBricqer.size}/${bricqer.size}`);
  if (unmatched.length) {
    console.log(`UNMATCHED Bricqer colours (${unmatched.length}) — need manual alias:`);
    for (const [id, name] of unmatched) console.log(`  bricqer ${id} = "${name}"`);
  } else {
    console.log('All Bricqer inventory colours mapped to a BL colour ✓');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
