'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useInvestmentPatterns } from '@/hooks/use-investment';
import {
  MAGNITUDE_VAR,
  POS_VAR,
  NEG_VAR,
  CHART_TOOLTIP_STYLE,
} from './investment-chart-tokens';

const THEME_CHART_LIMIT = 12;

function medianTooltip(value: number | undefined, _name: string, n?: number) {
  const v = value ?? 0;
  return [`${v > 0 ? '+' : ''}${v.toFixed(1)}% median 1yr${n != null ? ` (n=${n})` : ''}`, ''];
}

export function PatternsSection() {
  const { data, isLoading, error } = useInvestmentPatterns();

  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-72 animate-pulse rounded-lg border bg-muted" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="pt-4 text-sm text-destructive">
          Failed to load patterns{error ? `: ${error.message}` : ''}
        </CardContent>
      </Card>
    );
  }

  const themeData = data.by_theme.slice(0, THEME_CHART_LIMIT).map((t) => ({
    label: t.theme,
    value: t.median_1yr_pct ?? 0,
    n: t.n,
  }));

  // Sparse early cohorts (mostly pre-snapshot-era labels) still plot; the n in
  // the tooltip keeps their weight honest.
  const yearData = data.by_retirement_year.map((y) => ({
    label: String(y.year),
    value: y.median_1yr_pct ?? 0,
    n: y.n,
  }));

  const rrpData = data.by_rrp_band.map((b) => ({
    label: b.label,
    value: b.median_1yr_pct ?? 0,
    n: b.n,
  }));

  const licenceLine = data.by_licence
    .map((l) => `${l.label}: ${l.median_1yr_pct != null ? `+${l.median_1yr_pct}%` : '—'} (n=${l.n})`)
    .join('  ·  ');

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Theme patterns */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Median 1-year appreciation by theme</CardTitle>
            <CardDescription>
              Observed post-retirement outcomes, themes with ≥10 retired sets · overall median +
              {data.overall_median_1yr_pct ?? 0}% across {data.total_labels} sets
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(220, themeData.length * 26)}>
              <BarChart data={themeData} layout="vertical" margin={{ top: 5, right: 40, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                <XAxis
                  type="number"
                  className="text-xs fill-muted-foreground"
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={140}
                  className="text-xs fill-muted-foreground"
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(v: number | undefined, name, entry) =>
                    medianTooltip(v, String(name), (entry?.payload as { n?: number })?.n)
                  }
                />
                <Bar dataKey="value" fill={MAGNITUDE_VAR} radius={[2, 2, 2, 2]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Retirement-year cohorts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Median 1-year appreciation by retirement year</CardTitle>
            <CardDescription>
              How well each retirement cohort did one year after exit — the recent squeeze is real
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={yearData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis dataKey="label" className="text-xs fill-muted-foreground" tickLine={false} />
                <YAxis
                  className="text-xs fill-muted-foreground"
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1.5} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(v: number | undefined, name, entry) =>
                    medianTooltip(v, String(name), (entry?.payload as { n?: number })?.n)
                  }
                />
                <Bar dataKey="value" radius={[2, 2, 0, 0]} maxBarSize={24}>
                  {yearData.map((d, i) => (
                    <Cell key={i} fill={d.value >= 0 ? POS_VAR : NEG_VAR} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* RRP bands + licence split */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Median 1-year appreciation by RRP band</CardTitle>
          <CardDescription>{licenceLine}</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={rrpData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="label" className="text-xs fill-muted-foreground" tickLine={false} />
              <YAxis
                className="text-xs fill-muted-foreground"
                tickLine={false}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(v: number | undefined, name, entry) =>
                  medianTooltip(v, String(name), (entry?.payload as { n?: number })?.n)
                }
              />
              <Bar dataKey="value" fill={MAGNITUDE_VAR} radius={[2, 2, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
