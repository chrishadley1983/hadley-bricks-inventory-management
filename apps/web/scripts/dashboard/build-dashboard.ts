/**
 * Hadley Bricks business dashboard — build + deploy.
 * data → local Claude session (1-page position/next-steps summary, free on the Max sub
 * via the jobs-channel; deterministic fallback) → AES-GCM encrypt → inject into the
 * template → publish to surge (passcode-gated).
 *
 *   npx tsx --env-file=.env.local scripts/dashboard/build-dashboard.ts            # build + deploy
 *   npx tsx --env-file=.env.local scripts/dashboard/build-dashboard.ts --no-deploy  # local preview only
 */
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildDashboardData } from './data';

const HERE = dirname(fileURLToPath(import.meta.url));
const PASSCODE = process.env.HB_DASHBOARD_PASSCODE || 'HadleyBricks2026';
const DOMAIN = process.env.HB_DASHBOARD_DOMAIN || 'hadley-bricks-dashboard.surge.sh';
const CHANNEL = process.env.JOBS_CHANNEL_URL || 'http://127.0.0.1:8103/job';
const PBKDF2_ITERS = 150_000;

// ── local-AI summary (jobs-channel; Max-sub, zero API cost) ────────────
async function aiSummary(data: Awaited<ReturnType<typeof buildDashboardData>>): Promise<{ headline: string; position: string; nextSteps: string[]; watch: string[] }> {
  const t: any = data.traffic, s: any = data.sales, se: any = data.seo, f: any = data.feed, inv: any = data.inventory;
  const facts = {
    sales_7d: s?.error ? null : { revenue: Math.round(s.last7.revenue), net: s.last7.net, marginPct: s.last7.margin, units: s.last7.units, aov: Math.round(s.last7.aov), byPlatform: s.last7.byPlatform, deltaRevenuePct: s.delta.revenue, directSharePct: s.directShare, weeklyTarget: s.weeklyTarget, pacePct: s.pacePct, scope: s.scopeNote, topSets: s.topSets?.slice(0, 4) },
    traffic_28d: t?.error ? null : { sessions7d: t.last7.sessions, deltaSessionsPct: t.delta.sessions, aiSessions28: t.aiSessions28, sessions28: t.sessions28, channels: t.channels },
    search_28d: se?.error ? null : { clicks: se.curr.clicks, impressions: se.curr.impressions, position: Math.round(se.curr.position * 10) / 10, deltaClicksPct: se.delta.clicks, topQueries: se.topQueries?.slice(0, 5)?.map((q: any) => q.query) },
    feed: f?.error ? null : { approved: f.approved, disapproved: f.disapproved },
    inventory: inv?.error ? null : inv,
  };
  const prompt =
    'You are a senior e-commerce analyst for Hadley Bricks, a UK LEGO resale business selling across Amazon, eBay, BrickLink, Brick Owl and its own Shopify store (hadleybricks.co.uk). The strategic goal is growing DIRECT (Shopify) sales and AI-search visibility, which carry better margins than the marketplaces. ' +
    'Using the weekly data below, reply with STRICT JSON only (no markdown, no text outside the JSON), keys: ' +
    '"headline" (one punchy sentence, <=14 words, on the week\'s position), ' +
    '"position" (2-3 sentences, specific with the numbers: sales across channels, traffic/SEO momentum, direct-vs-marketplace, AI-assistant visibility), ' +
    '"nextSteps" (array of 3-4 short imperative highest-leverage actions, each <14 words), ' +
    '"watch" (array of 1-2 short risks to monitor, each <14 words). ' +
    'Be honest and concrete; small numbers are fine to call small. Call the reply tool with ONLY the JSON object.\n\nDATA:\n' +
    JSON.stringify(facts);

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 180_000);
    const r = await fetch(CHANNEL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: prompt, skill: 'hadley-bricks-dashboard-summary' }), signal: ctrl.signal });
    clearTimeout(to);
    if (r.ok) {
      const txt = ((await r.json()) as { response?: string }).response?.trim() || '';
      if (txt && txt.toUpperCase() !== 'NO_REPLY') {
        const json = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        const m = json.match(/\{[\s\S]*\}/);
        if (m) {
          const o = JSON.parse(m[0]);
          if (o.position) return { headline: o.headline || 'This week at a glance', position: o.position, nextSteps: o.nextSteps || [], watch: o.watch || [] };
        }
      }
    }
    console.warn('[dashboard] AI channel returned no usable JSON — using fallback');
  } catch (e) {
    console.warn('[dashboard] AI channel unavailable — using fallback:', e instanceof Error ? e.message : e);
  }
  // deterministic fallback
  const rev = s?.error ? 0 : Math.round(s.last7.revenue);
  const direct = s?.error ? 0 : s.directShare;
  const ai = t?.error ? 0 : t.aiSessions28;
  const clicks = se?.error ? 0 : se.curr.clicks;
  return {
    headline: `£${rev.toLocaleString()} in sales this week across all channels`,
    position: `Total sales were £${rev.toLocaleString()} over the last 7 days, with direct (Shopify) at ${direct}% of revenue. Organic search brought ${clicks} clicks in 28 days and AI assistants drove ${ai} sessions — the direct-and-AI flywheel the strategy is built on, still early.`,
    nextSteps: ['Publish a restoration/retired-set blog post and deep-link products', 'Add compare-at pricing to show the direct saving', 'Clear the remaining Merchant feed disapprovals', 'Capture emails to convert marketplace buyers to direct'],
    watch: ['Direct share still low — push the content engine', 'AI-referral trend week over week'],
  };
}

// ── AES-GCM encrypt (WebCrypto-compatible: payload = ciphertext||tag) ───
function encrypt(obj: unknown, passcode: string) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passcode, salt, PBKDF2_ITERS, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj))), c.final()]);
  const payload = Buffer.concat([ct, c.getAuthTag()]);
  return { payload: payload.toString('base64'), salt: salt.toString('base64'), iv: iv.toString('base64') };
}

function resolveSurge(): string {
  // Windows: surge is a .cmd on PATH; %APPDATA%\npm\surge.cmd is the usual fallback.
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA;
    if (appdata) {
      const p = join(appdata, 'npm', 'surge.cmd');
      try { readFileSync(p); return p; } catch { /* fall through */ }
    }
  }
  return 'surge';
}

async function main() {
  const noDeploy = process.argv.includes('--no-deploy');
  const now = new Date();
  console.log('[dashboard] gathering data…');
  const data = await buildDashboardData(now.toISOString());
  console.log('[dashboard] requesting AI summary…');
  const summary = await aiSummary(data);
  const full = { ...data, summary };

  const enc = encrypt(full, PASSCODE);
  const generatedLabel = now.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const template = readFileSync(join(HERE, 'template.html'), 'utf-8');
  const html = template
    .replace('__PAYLOAD__', enc.payload)
    .replace('__SALT__', enc.salt)
    .replace('__IV__', enc.iv)
    .replace('__ITERS__', String(PBKDF2_ITERS))
    .replace('__GENERATED_AT__', generatedLabel);

  if (noDeploy) {
    const out = join(HERE, '_preview.html');
    writeFileSync(out, html);
    console.log(`[dashboard] preview written: ${out} (passcode: ${PASSCODE})`);
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'hb-dash-'));
  writeFileSync(join(dir, 'index.html'), html);
  writeFileSync(join(dir, '200.html'), html); // SPA fallback
  console.log(`[dashboard] deploying to ${DOMAIN}…`);
  // shell:true on Windows splits on spaces, so quote the .cmd path + temp dir explicitly.
  const res = spawnSync(`"${resolveSurge()}" "${dir}" ${DOMAIN}`, { encoding: 'utf-8', shell: true });
  const out = (res.stdout || '') + (res.stderr || '');
  const ok = /success|published/i.test(out) || res.status === 0;
  console.log(out.split('\n').filter((l) => l.trim()).slice(-6).join('\n'));
  if (!ok) {
    console.error('[dashboard] surge deploy may have failed');
    process.exit(1);
  }
  console.log(`[dashboard] live: https://${DOMAIN}  (passcode: ${PASSCODE})`);
}

main().catch((e) => {
  console.error('[dashboard] FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
