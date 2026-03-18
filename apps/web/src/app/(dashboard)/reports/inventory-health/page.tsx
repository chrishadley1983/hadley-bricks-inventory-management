'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  Package,
  TrendingUp,
  ShoppingCart,
  Clock,
  Target,
  Warehouse,
  Activity,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/charts';
import { useInventoryHealthReport } from '@/hooks/use-reports';
import { usePerfPage } from '@/hooks/use-perf';
import { formatCurrency } from '@/lib/utils';
import { INVENTORY_HEALTH_TARGETS as TARGETS } from '@/lib/constants/inventory-health-targets';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

function getHealthBadge(status: 'green' | 'amber' | 'red') {
  switch (status) {
    case 'green':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Healthy</Badge>;
    case 'amber':
      return (
        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Watch
        </Badge>
      );
    case 'red':
      return (
        <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Action
        </Badge>
      );
  }
}

function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="space-y-1">
      {label && <p className="text-xs text-muted-foreground">{label}</p>}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground text-right">{Math.round(pct)}%</p>
    </div>
  );
}

export default function InventoryHealthPage() {
  usePerfPage('InventoryHealthPage');

  const { data: report, isLoading, error } = useInventoryHealthReport();

  return (
    <>
      <Header title="Inventory Health" />
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/reports">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Inventory Health</h1>
            <p className="text-muted-foreground">
              Amazon inventory KPIs, velocity, sourcing quality, and weekly trends
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Failed to load report. Please try again.
            </CardContent>
          </Card>
        ) : report ? (
          <>
            {/* Section 1: KPI Cards */}
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard
                title="Listed Items"
                value={report.kpis.listedCount}
                format="number"
                description={`Target: ${TARGETS.LISTED.toLocaleString()} (${Math.round((report.kpis.listedCount / TARGETS.LISTED) * 100)}%)`}
                icon={<Package className="h-4 w-4 text-muted-foreground" />}
              />
              <StatCard
                title="Inventory COG"
                value={report.kpis.inventoryCog}
                format="currency"
                description="Capital tied up in listed stock"
                icon={<Warehouse className="h-4 w-4 text-muted-foreground" />}
              />
              <StatCard
                title="Inventory Value"
                value={report.kpis.inventoryValue}
                format="currency"
                description="Total listing value"
              />
              <StatCard
                title="Value/COG Ratio"
                value={`${report.kpis.valueCogRatio.toFixed(1)}x`}
                description={
                  report.kpis.valueCogRatio >= TARGETS.VALUE_COG_RATIO
                    ? `Above ${TARGETS.VALUE_COG_RATIO}x target`
                    : `Below ${TARGETS.VALUE_COG_RATIO}x target`
                }
                trend={report.kpis.valueCogRatio >= TARGETS.VALUE_COG_RATIO ? 'up' : 'down'}
                icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
              />
            </div>

            {/* Capacity Progress Bar */}
            <Card>
              <CardContent className="pt-6">
                <ProgressBar
                  value={report.kpis.listedCount}
                  max={TARGETS.LISTED}
                  label={`Listed Stock: ${report.kpis.listedCount} / ${TARGETS.LISTED.toLocaleString()}`}
                />
              </CardContent>
            </Card>

            {/* Section 2 + 3: Velocity & Sourcing side by side */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Velocity */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Velocity
                  </CardTitle>
                  <CardDescription>Sales performance this week</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 grid-cols-2">
                    <div>
                      <p className="text-sm text-muted-foreground">Sold This Week</p>
                      <p className="text-2xl font-bold">{report.velocity.soldThisWeek}</p>
                      <p className="text-xs text-muted-foreground">
                        {report.velocity.sellThroughPct.toFixed(1)}% sell-through
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Weekly Gross</p>
                      <p className="text-2xl font-bold">
                        {formatCurrency(report.velocity.weeklyGrossRevenue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Median Days to Sell</p>
                      <p className="text-2xl font-bold">{report.velocity.medianDaysToSell}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Annual Pace</p>
                      <p className="text-2xl font-bold">
                        {formatCurrency(report.velocity.annualPace)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Target: {formatCurrency(TARGETS.ANNUAL_GROSS)}
                      </p>
                    </div>
                  </div>
                  <ProgressBar
                    value={report.velocity.annualPace}
                    max={TARGETS.ANNUAL_GROSS}
                    label="Annual Target Progress"
                  />
                </CardContent>
              </Card>

              {/* Sourcing Quality */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5" />
                    Sourcing Quality
                  </CardTitle>
                  <CardDescription>This week&apos;s buying and listing metrics</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 grid-cols-2">
                    <div>
                      <p className="text-sm text-muted-foreground">Bought This Week</p>
                      <p className="text-2xl font-bold">{report.sourcing.itemsBoughtThisWeek}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Listed This Week</p>
                      <p className="text-2xl font-bold">{report.sourcing.itemsListedThisWeek}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Avg COG (Bought)</p>
                      <p className="text-2xl font-bold">
                        {formatCurrency(report.sourcing.avgCogBought)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Avg List Value</p>
                      <p className="text-2xl font-bold">
                        {formatCurrency(report.sourcing.avgListValueListed)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">COG %</p>
                      <p className="text-2xl font-bold">
                        <span
                          className={
                            report.sourcing.cogPct <= TARGETS.COG_PCT
                              ? 'text-green-600'
                              : 'text-red-600'
                          }
                        >
                          {report.sourcing.cogPct.toFixed(1)}%
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Target: &le;{TARGETS.COG_PCT}%
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Net Stock Change</p>
                      <p className="text-2xl font-bold">
                        <span
                          className={
                            report.sourcing.netStockChange >= 0
                              ? 'text-green-600'
                              : 'text-red-600'
                          }
                        >
                          {report.sourcing.netStockChange >= 0 ? '+' : ''}
                          {report.sourcing.netStockChange}
                        </span>
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Section 4: Stock Health */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Stock Health
                </CardTitle>
                <CardDescription>Inventory aging breakdown for Amazon listed items</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Age Bracket</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">COG</TableHead>
                      <TableHead className="text-right">% of Listed</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.stockHealth.map((bracket) => (
                      <TableRow key={bracket.bracket}>
                        <TableCell className="font-medium">{bracket.bracket}</TableCell>
                        <TableCell className="text-right">{bracket.itemCount}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(bracket.cogAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {bracket.pctOfListed.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right">{getHealthBadge(bracket.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Section 5: Pipeline */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Pipeline
                </CardTitle>
                <CardDescription>Stock in the pipeline not yet listed</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Genuine Backlog</p>
                    <p className="text-2xl font-bold">{report.pipeline.genuineBacklog}</p>
                    <p className="text-xs text-muted-foreground">Ready to list</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Investment Holds</p>
                    <p className="text-2xl font-bold">{report.pipeline.investmentHolds}</p>
                    <p className="text-xs text-muted-foreground">Waiting for retirement</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Not Yet Received</p>
                    <p className="text-2xl font-bold">{report.pipeline.notYetReceived}</p>
                    <p className="text-xs text-muted-foreground">In post</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Weeks to Target</p>
                    <p className="text-2xl font-bold">
                      {report.pipeline.weeksToTarget !== null
                        ? `~${report.pipeline.weeksToTarget}`
                        : '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      To reach {TARGETS.LISTED.toLocaleString()} listed
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Section 6: 8-Week Trend */}
            <Card>
              <CardHeader>
                <CardTitle>8-Week Trend</CardTitle>
                <CardDescription>
                  Weekly performance metrics for Amazon
                </CardDescription>
              </CardHeader>
              <CardContent>
                {report.trends.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Week</TableHead>
                        <TableHead className="text-right">Listed</TableHead>
                        <TableHead className="text-right">Sold</TableHead>
                        <TableHead className="text-right">ST%</TableHead>
                        <TableHead className="text-right">COG%</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right">Net +/-</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.trends.map((week) => (
                        <TableRow key={week.weekStart}>
                          <TableCell className="font-medium">
                            {new Date(week.weekStart + 'T00:00:00').toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </TableCell>
                          <TableCell className="text-right">{week.listed}</TableCell>
                          <TableCell className="text-right">{week.sold}</TableCell>
                          <TableCell className="text-right">
                            {week.sellThroughPct.toFixed(1)}%
                          </TableCell>
                          <TableCell className="text-right">
                            <span
                              className={
                                week.cogPct <= TARGETS.COG_PCT ? 'text-green-600' : 'text-red-600'
                              }
                            >
                              {week.cogPct.toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(week.grossRevenue)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span
                              className={
                                week.netChange >= 0 ? 'text-green-600' : 'text-red-600'
                              }
                            >
                              {week.netChange >= 0 ? '+' : ''}
                              {week.netChange}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-center text-muted-foreground py-8">
                    No trend data available yet. Data will populate over the coming weeks.
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
