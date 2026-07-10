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
    delta: { sessions: pctDelta(last7.sessions, prev7.sessions, 20), revenue: pctDelta(last7.revenue, prev7.revenue), conversions: pctDelta(last7.conversions, prev7.conversions) },
    channels, aiSources, topPages, daily,
    aiSessions28: aiSources.reduce((s, x) => s + x.sessions, 0),
    sessions28: channels.reduce((s, x) => s + x.sessions, 0),
    organicShopping28: channels.find((c) => /organic shopping/i.test(c.name))?.sessions ?? 0,
    cvr: last7.sessions ? Math.round((last7.conversions / last7.sessions) * 1000) / 10 : 0,
    aov: last7.conversions ? last7.revenue / last7.conversions : 0,
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
  const topPages = (p.data.rows || []).sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).map((r) => ({ page: r.keys![0].replace('https://hadleybricks.co.uk', '').split('?')[0] || '/', clicks: r.clicks || 0, impressions: r.impressions || 0, position: Math.round((r.position || 0) * 10) / 10 }));

  // daily clicks + avg-position series for the ranking trend
  const ser = await sc.searchanalytics.query({ siteUrl: SC_SITE, requestBody: { startDate: start, endDate: end, dimensions: ['date'] } });
  const daily = (ser.data.rows || []).map((r) => ({ date: r.keys![0].slice(5).replace('-', '/'), clicks: r.clicks || 0, position: Math.round((r.position || 0) * 10) / 10 }));

  return {
    curr, prev,
    delta: { clicks: pctDelta(curr.clicks, prev.clicks), impressions: pctDelta(curr.impressions, prev.impressions), position: prev.position ? Math.round((curr.position - prev.position) * 10) / 10 : null },
    topQueries, topPages, daily,
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
  const [shopify, search, feed, store] = await Promise.all([
    safe('ga4', () => ga4(jwt)),
    safe('searchConsole', () => searchConsole(jwt)),
    safe('feedHealth', () => feedHealth(jwt)),
    safe('inventory', () => inventory()),
  ]);
  // Website / Shopify / SEO focus: shopify=GA4 site analytics, search=Search Console
  // ranking, feed=Google Merchant/Shopping, store=live listings.
  return { generatedAt: generatedAtIso, search, shopify, feed, store };
}

export type DashboardData = Awaited<ReturnType<typeof buildDashboardData>>;
