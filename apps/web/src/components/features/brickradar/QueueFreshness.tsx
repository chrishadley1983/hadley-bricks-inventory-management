'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { ListTree, ShieldCheck, Archive, AlertOctagon } from 'lucide-react';
import { CHART_TOOLTIP_STYLE, STATUS_TEXT, TREND_NEG_VAR, laneColorVar, seqVar, LANE_ORDER } from './chart-colors';
import { InfoTip } from './InfoTip';
import { laneLabel, type QueueTierSummary, type NextDueBucket, type LaneTelemetryDayRow } from './types';

function TierStat({
  icon: Icon,
  label,
  value,
  hint,
  info,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  hint: string;
  info?: string;
  tone?: 'good' | 'warn' | 'serious';
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border p-3">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone ? STATUS_TEXT[tone] : 'text-muted-foreground'}`} />
      <div>
        <div className={`text-lg font-semibold tabular-nums ${tone ? STATUS_TEXT[tone] : ''}`}>
          {value.toLocaleString()}
        </div>
        <div className="flex items-center gap-1 text-xs font-medium">
          {label}
          {info && <InfoTip text={info} />}
        </div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}

interface ChartTelemetryPoint {
  dateLabel: string;
  runDate: string;
  [lane: string]: string | number | null;
}

function pivotBlockRate(rows: LaneTelemetryDayRow[]): { points: ChartTelemetryPoint[]; lanesPresent: string[] } {
  const dateMap = new Map<string, ChartTelemetryPoint>();
  const lanesPresent = new Set<string>();

  for (const r of rows) {
    lanesPresent.add(r.lane);
    let point = dateMap.get(r.runDate);
    if (!point) {
      point = {
        dateLabel: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(r.runDate)),
        runDate: r.runDate,
      };
      dateMap.set(r.runDate, point);
    }
    // firstBlockAtRequest is already the per-day min across sessions (aggregateTelemetry).
    point[r.lane] = r.firstBlockAtRequest;
  }

  const points = [...dateMap.values()].sort((a, b) => a.runDate.localeCompare(b.runDate));
  const lanesOrdered = LANE_ORDER.filter((l) => lanesPresent.has(l));
  return { points, lanesPresent: lanesOrdered.length > 0 ? lanesOrdered : [...lanesPresent] };
}

function BlockRateTrendChart({ rows }: { rows: LaneTelemetryDayRow[] }) {
  const { points, lanesPresent } = pivotBlockRate(rows);
  const hasAnyBlockData = rows.some((r) => r.firstBlockAtRequest != null);

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No telemetry in the last 14 days yet.</p>;
  }

  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">Requests survived before the first block that session (higher = safer).</p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={points} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
          <XAxis dataKey="dateLabel" className="text-xs fill-muted-foreground" tickLine={false} />
          <YAxis className="text-xs fill-muted-foreground" tickLine={false} width={36} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelFormatter={(v) => `${v}`} />
          {lanesPresent.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => laneLabel(v)} />}
          {lanesPresent.map((lane) => (
            <Line
              key={lane}
              type="monotone"
              dataKey={lane}
              name={laneLabel(lane)}
              stroke={laneColorVar(lane)}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {!hasAnyBlockData && (
        <p className="mt-2 text-xs text-muted-foreground">
          No 403 blocks recorded in this window — every session ran its full request budget clean.
        </p>
      )}
    </div>
  );
}

function NextDueDistributionChart({ buckets }: { buckets: NextDueBucket[] }) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">No active-tier tuples in the queue yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={buckets} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
        <XAxis dataKey="label" className="text-xs fill-muted-foreground" tickLine={false} />
        <YAxis className="text-xs fill-muted-foreground" tickLine={false} width={40} allowDecimals={false} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number | undefined) => [(v ?? 0).toLocaleString(), 'Tuples']} />
        <Bar dataKey="count" name="Tuples" radius={[3, 3, 0, 0]} maxBarSize={56}>
          {buckets.map((b, i) => (
            <Cell key={b.label} fill={b.overdue ? TREND_NEG_VAR : seqVar(i - (buckets[0]?.overdue ? 1 : 0))} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function QueueFreshness({
  tiers,
  buckets,
  telemetry14d,
}: {
  tiers: QueueTierSummary;
  buckets: NextDueBucket[];
  telemetry14d: LaneTelemetryDayRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Queue &amp; freshness
          <InfoTip text="Section overview: how the refresh queue is split into tiers, how safely each lane is scraping, and how the active tier's 60-day cycle is spread across time." />
        </CardTitle>
        <CardDescription>
          Refresh-queue tier composition, the sessions-to-first-403 trend (the tripwire for throttling down before a
          real ban), and how the active tier&apos;s 60-day refresh cycle is spread out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <TierStat
            icon={ListTree}
            label="Active tier"
            value={tiers.activeTotal}
            hint="on the 60d cycle"
            info="Tuples on the 60-day refresh cycle (28 days for new-for-the-year items) — the highest-value, most closely tracked slice of the catalogue."
          />
          <TierStat
            icon={ShieldCheck}
            label="By rank"
            value={tiers.activeByRank}
            hint="qualifies on 6mo value"
            info="Active tuples that qualify purely on their 6-month sold-value ranking (the top ~60k)."
          />
          <TierStat
            icon={ShieldCheck}
            label="By grace"
            value={tiers.activeByGrace}
            hint="new-release grace window"
            info="Newly released items held in the active tier during their grace window, even before they'd otherwise rank in on value."
          />
          <TierStat
            icon={ShieldCheck}
            label="By floor"
            value={tiers.activeByFloor}
            hint="watchlist / own inventory"
            info="Active tuples pinned in because we hold stock or are watching them, regardless of rank."
          />
          <TierStat
            icon={Archive}
            label="Tail tier"
            value={tiers.tailTotal}
            hint="off-cycle, refreshed on demand"
            info="Everything else — refreshed slower, on demand, with worldwide summary only (no UK detail)."
          />
          <TierStat
            icon={AlertOctagon}
            label="Past due"
            value={tiers.pastDueCount}
            hint="active tuples overdue"
            info="Active tuples overdue for refresh — the nightly cycle works these first."
            tone={tiers.pastDueCount > 0 ? 'warn' : 'good'}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              Block-rate trend — last 14 days
              <InfoTip text="Block-rate trend = how many requests each scrape session survived before BrickLink challenged it; higher = safer." />
            </h4>
            <BlockRateTrendChart rows={telemetry14d} />
          </div>
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              Next-due distribution — active tier
              <InfoTip text="How the active tier's 60-day refresh cycle is spread across time buckets — a healthy queue has most tuples not yet due (the first-touch backlog sits in Past due until it drains)." />
            </h4>
            <NextDueDistributionChart buckets={buckets} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
