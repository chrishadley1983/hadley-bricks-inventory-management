/**
 * GET /api/investment/patterns
 *
 * Aggregates observed post-retirement appreciation (investment_historical
 * labels, median_window_v2) into patterns for the dashboard: by theme, by
 * retirement-year cohort, by RRP band, and licensed vs unlicensed.
 *
 * Medians lead every aggregate (house convention); means shown alongside.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { fetchAllRecords } from '@/lib/supabase/pagination';

const MIN_THEME_SAMPLE = 10;

const RRP_BANDS = [
  { key: 'under_25', label: 'Under £25', min: 0, max: 25 },
  { key: '25_50', label: '£25–50', min: 25, max: 50 },
  { key: '50_100', label: '£50–100', min: 50, max: 100 },
  { key: '100_200', label: '£100–200', min: 100, max: 200 },
  { key: 'over_200', label: '£200+', min: 200, max: Infinity },
] as const;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function round1(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10) / 10;
}

interface LabelRow {
  set_num: string;
  retired_date: string | null;
  rrp_gbp: number | null;
  actual_1yr_appreciation: number;
  theme: string | null;
  is_licensed: boolean | null;
}

export async function GET() {
  try {
    const { unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    const supabase = createServiceRoleClient();

    const labels = (await fetchAllRecords(supabase, 'investment_historical', {
      select: 'set_num, retired_date, rrp_gbp, actual_1yr_appreciation',
      neq: { set_num: '__model_artifact__' },
      isNotNull: ['actual_1yr_appreciation'],
    })) as unknown as Omit<LabelRow, 'theme' | 'is_licensed'>[];

    // Join theme/licence flags from brickset_sets in chunks (no FK for embeds)
    const setNums = labels.map((l) => l.set_num);
    const setMeta = new Map<string, { theme: string | null; is_licensed: boolean | null }>();
    for (let i = 0; i < setNums.length; i += 200) {
      const { data: sets, error } = await supabase
        .from('brickset_sets')
        .select('set_number, theme, is_licensed')
        .in('set_number', setNums.slice(i, i + 200));
      if (error) {
        console.error('[GET /api/investment/patterns] Set join error:', error.message);
        return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
      }
      for (const s of (sets ?? []) as unknown as Record<string, unknown>[]) {
        setMeta.set(s.set_number as string, {
          theme: s.theme as string | null,
          is_licensed: s.is_licensed as boolean | null,
        });
      }
    }

    const rows: LabelRow[] = labels.map((l) => ({
      ...l,
      theme: setMeta.get(l.set_num)?.theme ?? null,
      is_licensed: setMeta.get(l.set_num)?.is_licensed ?? null,
    }));

    // By theme (min sample size so one lucky set can't fake a pattern)
    const themeGroups = new Map<string, number[]>();
    for (const r of rows) {
      if (!r.theme) continue;
      const group = themeGroups.get(r.theme) ?? [];
      group.push(r.actual_1yr_appreciation);
      themeGroups.set(r.theme, group);
    }
    const byTheme = [...themeGroups.entries()]
      .filter(([, values]) => values.length >= MIN_THEME_SAMPLE)
      .map(([theme, values]) => ({
        theme,
        n: values.length,
        median_1yr_pct: round1(median(values)),
        mean_1yr_pct: round1(mean(values)),
      }))
      .sort((a, b) => (b.median_1yr_pct ?? -Infinity) - (a.median_1yr_pct ?? -Infinity));

    // By retirement-year cohort
    const yearGroups = new Map<number, number[]>();
    for (const r of rows) {
      if (!r.retired_date) continue;
      const year = new Date(r.retired_date).getFullYear();
      const group = yearGroups.get(year) ?? [];
      group.push(r.actual_1yr_appreciation);
      yearGroups.set(year, group);
    }
    const byRetirementYear = [...yearGroups.entries()]
      .map(([year, values]) => ({
        year,
        n: values.length,
        median_1yr_pct: round1(median(values)),
      }))
      .sort((a, b) => a.year - b.year);

    // By RRP band
    const byRrpBand = RRP_BANDS.map((band) => {
      const values = rows
        .filter((r) => r.rrp_gbp != null && r.rrp_gbp >= band.min && r.rrp_gbp < band.max)
        .map((r) => r.actual_1yr_appreciation);
      return {
        band: band.key,
        label: band.label,
        n: values.length,
        median_1yr_pct: round1(median(values)),
      };
    });

    // Licensed vs unlicensed
    const licensedValues = rows
      .filter((r) => r.is_licensed === true)
      .map((r) => r.actual_1yr_appreciation);
    const unlicensedValues = rows
      .filter((r) => r.is_licensed === false)
      .map((r) => r.actual_1yr_appreciation);
    const byLicence = [
      {
        group: 'licensed',
        label: 'Licensed',
        n: licensedValues.length,
        median_1yr_pct: round1(median(licensedValues)),
      },
      {
        group: 'unlicensed',
        label: 'Unlicensed',
        n: unlicensedValues.length,
        median_1yr_pct: round1(median(unlicensedValues)),
      },
    ];

    return NextResponse.json({
      total_labels: rows.length,
      overall_median_1yr_pct: round1(median(rows.map((r) => r.actual_1yr_appreciation))),
      by_theme: byTheme,
      by_retirement_year: byRetirementYear,
      by_rrp_band: byRrpBand,
      by_licence: byLicence,
    });
  } catch (error) {
    console.error('[GET /api/investment/patterns] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
