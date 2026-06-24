#!/usr/bin/env node
/**
 * validate-ai-audit.mjs — production validation for shared AI-usage audit logging.
 *
 * WHAT IT DOES
 *   1. Prints a TRIGGER step: how to produce one real Anthropic-API-key call on
 *      production (create an eBay listing, or run a school script).
 *   2. Reads the shared `public.ai_api_usage` table from Supabase project
 *      modjoikyuhqzouxvieua, filtered to project="hadley-bricks" and rows
 *      created in the last 15 minutes.
 *   3. Prints PASS (a row was found — shows feature / model / tokens) or FAIL.
 *
 * WHY A SERVICE-ROLE KEY
 *   The table's RLS is INSERT-ONLY for the publishable key — the publishable key
 *   CANNOT read rows back. Reading therefore requires a SERVICE-ROLE key, supplied
 *   via the env var AI_USAGE_SERVICE_KEY. (This is the modjoikyuhqzouxvieua
 *   service_role key, i.e. Hadley Bricks' SUPABASE_SERVICE_ROLE_KEY.)
 *
 * USAGE
 *   # 1. Trigger a real call on production, e.g. create one eBay listing in the app,
 *   #    or run a school script:  python scripts/school/term_dates_poller.py
 *   #
 *   # 2. Within 15 minutes, run:
 *   AI_USAGE_SERVICE_KEY="<modjoikyuhqzouxvieua service_role key>" \
 *     node scripts/validate-ai-audit.mjs
 *
 *   # Optional overrides:
 *   AI_USAGE_SUPABASE_URL  (default https://modjoikyuhqzouxvieua.supabase.co)
 *   AI_USAGE_WINDOW_MIN    (default 15)
 *   AI_USAGE_FEATURE       (filter to one feature, e.g. ebay_listing_generation)
 *
 * EXIT CODES
 *   0 = PASS (at least one matching row found)
 *   1 = FAIL (no row found in the window)
 *   2 = configuration error (missing service key, HTTP error, etc.)
 */

const SUPABASE_URL =
  process.env.AI_USAGE_SUPABASE_URL || 'https://modjoikyuhqzouxvieua.supabase.co';
const SERVICE_KEY = process.env.AI_USAGE_SERVICE_KEY;
const WINDOW_MIN = Number(process.env.AI_USAGE_WINDOW_MIN || 15);
const FEATURE_FILTER = process.env.AI_USAGE_FEATURE || null;
const PROJECT = 'hadley-bricks';

function printTriggerStep() {
  console.log('─'.repeat(72));
  console.log('STEP 1 — trigger one real Anthropic-API-key call on production:');
  console.log('');
  console.log('  Option A (eBay listing — web app):');
  console.log('    Open https://hadley-bricks-inventory-management.vercel.app');
  console.log('    → Inventory → pick an item → "Create eBay listing" → Generate.');
  console.log('    (Logs feature="ebay_listing_generation", and');
  console.log('     "ebay_listing_improvement" if the quality loop runs.)');
  console.log('');
  console.log('  Option B (school script — logs from the Python helper):');
  console.log('    cd <repo> && python scripts/school/term_dates_poller.py');
  console.log('    (Logs feature="school_term_dates".)');
  console.log('');
  console.log(`STEP 2 — within ${WINDOW_MIN} min, this script reads ai_api_usage back.`);
  console.log('─'.repeat(72));
  console.log('');
}

async function main() {
  printTriggerStep();

  if (!SERVICE_KEY) {
    console.error(
      'CONFIG ERROR: AI_USAGE_SERVICE_KEY is not set.\n' +
        '  The publishable key is INSERT-only (RLS) and cannot read rows.\n' +
        '  Set AI_USAGE_SERVICE_KEY to the modjoikyuhqzouxvieua service_role key\n' +
        '  (Hadley Bricks SUPABASE_SERVICE_ROLE_KEY) and re-run.'
    );
    process.exit(2);
  }

  const sinceIso = new Date(Date.now() - WINDOW_MIN * 60 * 1000).toISOString();

  // PostgREST query: project=eq.hadley-bricks & created_at >= since, newest first.
  const params = new URLSearchParams();
  params.set('project', `eq.${PROJECT}`);
  params.set('created_at', `gte.${sinceIso}`);
  if (FEATURE_FILTER) {
    params.set('feature', `eq.${FEATURE_FILTER}`);
  }
  params.set('order', 'created_at.desc');
  params.set('limit', '20');
  params.set(
    'select',
    'created_at,feature,model,billing_source,status,input_tokens,output_tokens,' +
      'cache_creation_input_tokens,cache_read_input_tokens,request_ms,anthropic_message_id,error'
  );

  const url = `${SUPABASE_URL}/rest/v1/ai_api_usage?${params.toString()}`;

  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    console.error(`CONFIG ERROR: request failed: ${err?.message ?? err}`);
    process.exit(2);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error(`CONFIG ERROR: HTTP ${resp.status} reading ai_api_usage: ${body.slice(0, 300)}`);
    process.exit(2);
  }

  const rows = await resp.json();

  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('');
    console.log(
      `FAIL — no ai_api_usage rows for project="${PROJECT}"` +
        (FEATURE_FILTER ? ` feature="${FEATURE_FILTER}"` : '') +
        ` in the last ${WINDOW_MIN} min.`
    );
    console.log('  Did you trigger a call? Did logging get deployed? Check the chokepoint.');
    process.exit(1);
  }

  console.log(`PASS — found ${rows.length} ai_api_usage row(s) in the last ${WINDOW_MIN} min:`);
  console.log('');
  for (const r of rows) {
    const tokens =
      `in=${r.input_tokens ?? '-'} out=${r.output_tokens ?? '-'}` +
      ` cc=${r.cache_creation_input_tokens ?? '-'} cr=${r.cache_read_input_tokens ?? '-'}`;
    console.log(
      `  [${r.created_at}] ${r.status}` +
        `  feature=${r.feature ?? '-'}  model=${r.model ?? '-'}` +
        `  ${tokens}  ms=${r.request_ms ?? '-'}` +
        (r.anthropic_message_id ? `  id=${r.anthropic_message_id}` : '') +
        (r.error ? `  error="${String(r.error).slice(0, 80)}"` : '')
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`CONFIG ERROR: ${err?.message ?? err}`);
  process.exit(2);
});
