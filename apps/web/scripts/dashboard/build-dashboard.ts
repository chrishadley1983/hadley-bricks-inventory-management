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
  const sh: any = data.shopify, se: any = data.search, f: any = data.feed, st: any = data.store;
  const facts = {
    search_28d: se?.error ? null : { clicks: se.curr.clicks, impressions: se.curr.impressions, ctrPct: Math.round(se.curr.ctr * 1000) / 10, avgPosition: Math.round(se.curr.position * 10) / 10, positionChange: se.delta.position, clicksDeltaPct: se.delta.clicks, topQueries: se.topQueries?.slice(0, 6)?.map((q: any) => `${q.query} (pos ${q.position}, ${q.clicks}c/${q.impressions}i)`), topPages: se.topPages?.slice(0, 4)?.map((p: any) => p.page) },
    shopify_site: sh?.error ? null : { sessions7d: sh.last7.sessions, sessionsDeltaPct: sh.delta.sessions, aiSessions28: sh.aiSessions28, sessions28: sh.sessions28, organicShopping28: sh.organicShopping28, channels: sh.channels, conversions7d: sh.last7.conversions, conversionRatePct: sh.cvr, directRevenue7d: Math.round(sh.last7.revenue * 100) / 100 },
    google_shopping_feed: f?.error ? null : { approvedFreeListings: f.approved, total: f.total, disapproved: f.disapproved, topIssues: f.topIssues },
    listings: st?.error ? null : st,
  };
  const prompt =
    'You are a senior SEO / e-commerce-growth analyst for Hadley Bricks, a UK LEGO resale business. THIS DASHBOARD IS ABOUT THE WEBSITE ONLY — hadleybricks.co.uk (Shopify) — NOT the Amazon/eBay/BrickLink/Brick Owl marketplaces. The goal is growing the website via organic search ranking, Google Shopping, AI-search (GEO) visibility, and on-site conversion to direct sales. ' +
    'Using the weekly data below, reply with STRICT JSON only (no markdown, no text outside the JSON), keys: ' +
    '"headline" (one punchy sentence, <=14 words, on the website/SEO position this week), ' +
    '"position" (2-3 sentences, specific with the numbers: organic ranking/clicks/avg-position momentum, Google Shopping feed + Shopping traffic, AI-assistant visibility, Shopify sessions + conversion + direct sales), ' +
    '"nextSteps" (array of 3-4 short imperative highest-leverage SEO/Shopping/Shopify actions, each <14 words), ' +
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
  const clicks = se?.error ? 0 : se.curr.clicks;
  const pos = se?.error ? 0 : se.curr.position;
  const ai = sh?.error ? 0 : sh.aiSessions28;
  const sess = sh?.error ? 0 : sh.last7.sessions;
  const appr = f?.error ? 0 : f.approved;
  const tot = f?.error ? 0 : f.total;
  return {
    headline: `${clicks} organic clicks in 28 days, avg position ${(pos || 0).toFixed(1)}`,
    position: `Organic search brought ${clicks} clicks in 28 days at avg position ${(pos || 0).toFixed(1)}; the Shopify site saw ${sess} sessions in 7 days with ${ai} from AI assistants. The Google Merchant feed has ${appr}/${tot} products approved for free listings. The website-and-AI flywheel is early but building.`,
    nextSteps: ['Publish a retired-set/restoration blog post and deep-link products', 'Clear the remaining Merchant feed disapprovals', 'Add GTIN/MPN to lift Google Shopping impressions', 'Sharpen titles/meta on near-page-1 queries to win clicks'],
    watch: ['Avg position still page 2 — impressions not converting to clicks', 'AI-referral + organic-shopping trend week over week'],
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
