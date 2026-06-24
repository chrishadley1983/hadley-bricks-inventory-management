/**
 * Hadley Bricks business-dashboard data layer.
 * Gathers traffic (GA4), SEO (Search Console), sales (Supabase inventory_items),
 * Google Merchant feed health (Content API), and inventory into one JSON model.
 * Every source is wrapped so a failure degrades to null rather than breaking the build.
 *
 * Auth: GA4/SC/Content via the Sheets service account (SEO_AUTH=sa style); Supabase via
 * service role. Run from apps/web with --env-file=.env.local.
 */
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

const GA4_PROPERTY = process.env.GA4_PROPERTY_ID || '541958510';
const SC_SITE = process.env.SC_SITE || 'sc-domain:hadleybricks.co.uk';
const MERCHANT_ID = process.env.MERCHANT_ID || '5809583788';

// ── auth ───────────────────────────────────────────────────────────────
function resolvePrivateKey(): string {
  const b64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (b64) return Buffer.from(b64, 'base64').toString('utf-8');
  return (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}
function googleJwt() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: resolvePrivateKey(),
    scopes: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/content',
    ],
  });
}
function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
}

// ── date helpers ───────────────────────────────────────────────────────
const DAY = 86400000;
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY);
}
function pctDelta(curr: number, prev: number, floor = 0): number | null {
  if (!prev || prev < floor) return null; // base-effect guard: a tiny prior period isn't decision-grade
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}
const WEEKLY_REVENUE_TARGET = Math.round(80000 / 52); // £80k/yr FY plan ≈ £1,538/wk

// ── GA4 ────────────────────────────────────────────────────────────────
async function ga4(jwt: ReturnType<typeof googleJwt>) {
  const data = google.analyticsdata({ version: 'v1beta', auth: jwt });
  const prop = `properties/${GA4_PROPERTY}`;
  const num = (v: string | null | undefined) => Number(v || 0);

  async function totals(start: string, end: string) {
    const r = await data.properties.runReport({
      property: prop,
      requestBody: { dateRanges: [{ startDate: start, endDate: end }], metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'conversions' }, { name: 'totalRevenue' }] },
    });
    const m = r.data.rows?.[0]?.metricValues?.map((x) => num(x.value)) || [0, 0, 0, 0];
    return { sessions: m[0], users: m[1], conversions: m[2], revenue: m[3] };
  }

  const last7 = await totals('7daysAgo', 'today');
  const prev7 = await totals('14daysAgo', '8daysAgo');

  // channels (28d)
  const ch = await data.properties.runReport({
    property: prop,
    requestBody: { dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: '15' },
  });
  const channels = (ch.data.rows || []).map((r) => ({ name: r.dimensionValues![0].value!, sessions: num(r.metricValues![0].value) }));

  // AI referrals (28d)
  const src = await data.properties.runReport({
    property: prop,
    requestBody: { dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }], dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: '50' },
  });
  const AI = /chatgpt|openai|perplexity|gemini|bard|copilot|claude|chat\.com/i;
  const aiSources = (src.data.rows || []).filter((r) => AI.test(r.dimensionValues![0].value || '')).map((r) => ({ source: r.dimensionValues![0].value!, sessions: num(r.metricValues![0].value) }));

  // top landing pages (28d)
  const lp = await data.properties.runReport({
    property: prop,
    requestBody: { dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }], dimensions: [{ name: 'landingPagePlusQueryString' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: '8' },
  });
  const topPages = (lp.data.rows || []).map((r) => ({ page: (r.dimensionValues![0].value || '').split('?')[0], sessions: num(r.metricValues![0].value) }));

  // daily sessions series (42d) — denser than weekly given the short property history
  const ser = await data.properties.runReport({
    property: prop,
    requestBody: { dateRanges: [{ startDate: '41daysAgo', endDate: 'today' }], dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }], orderBys: [{ dimension: { dimensionName: 'date' } }] },
  });
  const daily = (ser.data.rows || []).map((r) => {
    const d = r.dimensionValues![0].value!;
    return { date: `${d.slice(4, 6)}/${d.slice(6, 8)}`, sessions: num(r.metricValues![0].value) };
  });

  return {
    last7, prev7,
    delta: { sessions: pctDelta(last7.sessions, prev7.sessions, 20), revenue: pctDelta(last7.revenue, prev7.revenue) },
    channels, aiSources, topPages, daily,
    aiSessions28: aiSources.reduce((s, x) => s + x.sessions, 0),
    sessions28: channels.reduce((s, x) => s + x.sessions, 0),
  };
}

// ── Search Console ─────────────────────────────────────────────────────
async function searchConsole(jwt: ReturnType<typeof googleJwt>) {
  const sc = google.searchconsole({ version: 'v1', auth: jwt });
  const start = ymd(daysAgo(31));
  const end = ymd(daysAgo(3)); // ~3d latency
  const prevStart = ymd(daysAgo(59));
  const prevEnd = ymd(daysAgo(31));

  async function tot(s: string, e: string) {
    const r = await sc.searchanalytics.query({ siteUrl: SC_SITE, requestBody: { startDate: s, endDate: e, dimensions: [] } });
    const row = r.data.rows?.[0];
    return { clicks: row?.clicks || 0, impressions: row?.impressions || 0, ctr: row?.ctr || 0, position: row?.position || 0 };
  }
  const curr = await tot(start, end);
  const prev = await tot(prevStart, prevEnd);

  const q = await sc.searchanalytics.query({ siteUrl: SC_SITE, requestBody: { startDate: start, endDate: end, dimensions: ['query'], rowLimit: 12 } });
  const topQueries = (q.data.rows || []).sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).map((r) => ({ query: r.keys![0], clicks: r.clicks || 0, impressions: r.impressions || 0, position: Math.round((r.position || 0) * 10) / 10 }));

  const p = await sc.searchanalytics.query({ siteUrl: SC_SITE, requestBody: { startDate: start, endDate: end, dimensions: ['page'], rowLimit: 8 } });
  const topPages = (p.data.rows || []).sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).map((r) => ({ page: r.keys![0].replace('https://hadleybricks.co.uk', ''), clicks: r.clicks || 0, impressions: r.impressions || 0 }));

  return { curr, prev, delta: { clicks: pctDelta(curr.clicks, prev.clicks), impressions: pctDelta(curr.impressions, prev.impressions) }, topQueries, topPages };
}

// ── Sales (Supabase inventory_items sold rows) ─────────────────────────
const PLATFORM_LABEL: Record<string, string> = { amazon: 'Amazon', ebay: 'eBay', bricklink: 'BrickLink', brickowl: 'Brick Owl', shopify: 'Shopify' };
function platformKey(p: string | null): string {
  const x = (p || 'unknown').toLowerCase();
  if (x.includes('amazon')) return 'amazon';
  if (x.includes('ebay')) return 'ebay';
  if (x.includes('brickowl') || x === 'bo') return 'brickowl';
  if (x.includes('bricklink') || x === 'bl') return 'bricklink';
  if (x.includes('shopify')) return 'shopify';
  return x;
}
async function sales() {
  const supabase = sb();
  // pull sold rows for the last 12 weeks
  const since = ymd(daysAgo(84));
  const rows: Array<{ sold_date: string | null; sold_platform: string | null; sold_net_amount: number | null; sold_gross_amount: number | null; sold_price: number | null; cost: number | null; set_number: string | null; item_name: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('sold_date, sold_platform, sold_net_amount, sold_gross_amount, sold_price, cost, set_number, item_name')
      .eq('status', 'SOLD')
      .gte('sold_date', since)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as never[]));
    if (data.length < 1000) break;
  }
  const amount = (r: (typeof rows)[number]) => Number(r.sold_gross_amount ?? r.sold_price ?? 0);

  function windowAgg(startDays: number, endDays: number) {
    const s = ymd(daysAgo(startDays));
    const e = ymd(daysAgo(endDays));
    const win = rows.filter((r) => r.sold_date && r.sold_date >= s && r.sold_date < e);
    const byPlatform: Record<string, { revenue: number; units: number }> = {};
    let revenue = 0, units = 0, net = 0, cog = 0, netCovered = 0, cogCovered = 0;
    for (const r of win) {
      const k = platformKey(r.sold_platform);
      byPlatform[k] = byPlatform[k] || { revenue: 0, units: 0 };
      byPlatform[k].revenue += amount(r);
      byPlatform[k].units += 1;
      revenue += amount(r);
      units += 1;
      if (r.sold_net_amount != null) { net += Number(r.sold_net_amount); netCovered++; }
      if (r.cost != null) { cog += Number(r.cost); cogCovered++; }
    }
    // only surface profit when net + cost are present for ~all units in the window
    const haveProfit = units > 0 && netCovered / units >= 0.9 && cogCovered / units >= 0.9;
    const grossProfit = haveProfit ? net - cog : null;
    const margin = haveProfit && revenue ? Math.round(((grossProfit as number) / revenue) * 1000) / 10 : null;
    return { revenue, units, aov: units ? revenue / units : 0, byPlatform, net: haveProfit ? Math.round(net) : null, grossProfit: grossProfit != null ? Math.round(grossProfit) : null, margin };
  }
  const last7 = windowAgg(7, 0);
  const prev7 = windowAgg(14, 7);

  // weekly series (12 weeks)
  const weekly: Array<{ label: string; revenue: number; units: number }> = [];
  for (let w = 11; w >= 0; w--) {
    const a = windowAgg((w + 1) * 7, w * 7);
    weekly.push({ label: `-${w}w`, revenue: Math.round(a.revenue), units: a.units });
  }

  // top sets (last 28d by revenue)
  const since28 = ymd(daysAgo(28));
  const setAgg: Record<string, { name: string; revenue: number; units: number }> = {};
  for (const r of rows.filter((x) => x.sold_date && x.sold_date >= since28)) {
    const k = r.set_number || r.item_name || '?';
    setAgg[k] = setAgg[k] || { name: r.item_name || k, revenue: 0, units: 0 };
    setAgg[k].revenue += amount(r);
    setAgg[k].units += 1;
  }
  const topSets = Object.entries(setAgg).map(([set, v]) => ({ set, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 8);

  const directRev = last7.byPlatform.shopify?.revenue || 0;
  const directShare = last7.revenue ? Math.round((directRev / last7.revenue) * 1000) / 10 : 0;

  return {
    last7, prev7,
    delta: { revenue: pctDelta(last7.revenue, prev7.revenue), units: pctDelta(last7.units, prev7.units) },
    weekly, topSets,
    directShare,
    weeklyTarget: WEEKLY_REVENUE_TARGET,
    pacePct: WEEKLY_REVENUE_TARGET ? Math.round((last7.revenue / WEEKLY_REVENUE_TARGET) * 100) : null,
    platformLabels: PLATFORM_LABEL,
    // BrickLink & Brick Owl sales flow through Bricqer and aren't in inventory_items yet.
    scopeNote: 'Amazon · eBay · Shopify (BrickLink & Brick Owl run via Bricqer — not captured yet)',
  };
}

// ── Merchant feed health (Content API) ─────────────────────────────────
async function feedHealth(jwt: ReturnType<typeof googleJwt>) {
  const content = google.content({ version: 'v2.1', auth: jwt as never });
  const servability: Record<string, number> = {};
  const issues: Record<string, { count: number; servability: string }> = {};
  let total = 0;
  let pageToken: string | undefined;
  for (;;) {
    const res = (await content.productstatuses.list({ merchantId: MERCHANT_ID, maxResults: 250, pageToken })) as never as {
      data: { resources?: Array<{ destinationStatuses?: Array<{ status?: string }>; itemLevelIssues?: Array<{ description?: string; servability?: string }> }>; nextPageToken?: string };
    };
    for (const p of res.data.resources || []) {
      total++;
      // A product counts as disapproved only when it has a genuine disapproving item-level
      // issue (the meaningful free-listings signal) — NOT the account-wide Shopping-ads
      // destination disapproval that hits every product when Google Ads isn't linked.
      const disIssues = (p.itemLevelIssues || []).filter((i) => i.servability === 'disapproved');
      if (disIssues.length) {
        servability['disapproved'] = (servability['disapproved'] || 0) + 1;
        const seen = new Set<string>(); // one count per product per issue (dedupe destinations)
        for (const i of disIssues) {
          const k = i.description || 'issue';
          if (seen.has(k)) continue;
          seen.add(k);
          issues[k] = issues[k] || { count: 0, servability: 'disapproved' };
          issues[k].count++;
        }
      } else {
        servability['approved'] = (servability['approved'] || 0) + 1;
      }
    }
    pageToken = res.data.nextPageToken;
    if (!pageToken) break;
  }
  const topIssues = Object.entries(issues).map(([desc, v]) => ({ desc, count: v.count })).sort((a, b) => b.count - a.count).slice(0, 5);
  return { total, approved: servability['approved'] || 0, disapproved: servability['disapproved'] || 0, pending: servability['pending'] || 0, topIssues };
}

// ── Inventory ──────────────────────────────────────────────────────────
async function inventory() {
  const supabase = sb();
  let listed = 0;
  let listingValue = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('inventory_items').select('listing_value').eq('status', 'LISTED').range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    listed += data.length;
    for (const r of data as Array<{ listing_value: number | null }>) listingValue += Number(r.listing_value || 0);
    if (data.length < 1000) break;
  }
  return { listed, listingValue: Math.round(listingValue) };
}

// ── assemble ───────────────────────────────────────────────────────────
async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[dashboard-data] ${label} failed:`, e instanceof Error ? e.message : e);
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function buildDashboardData(generatedAtIso: string) {
  const jwt = googleJwt();
  const [traffic, seo, sale, feed, inv] = await Promise.all([
    safe('ga4', () => ga4(jwt)),
    safe('searchConsole', () => searchConsole(jwt)),
    safe('sales', () => sales()),
    safe('feedHealth', () => feedHealth(jwt)),
    safe('inventory', () => inventory()),
  ]);
  return {
    generatedAt: generatedAtIso,
    traffic,
    seo,
    sales: sale,
    feed,
    inventory: inv,
  };
}

export type DashboardData = Awaited<ReturnType<typeof buildDashboardData>>;
