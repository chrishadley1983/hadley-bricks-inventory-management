'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, Download, Loader2, Clock, AlertTriangle, DollarSign, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { StatCard, BarChart, PieChart } from '@/components/charts';
import { useInventoryAgingReport, useExportReport } from '@/hooks/use-reports';
import { usePerfPage } from '@/hooks/use-perf';
import type { InventoryAgingReport } from '@/lib/services';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

const BRACKET_COLORS: Record<string, string> = {
  '0-30 days': '#10b981',
  '31-60 days': '#3b82f6',
  '61-90 days': '#f59e0b',
  '91-180 days': '#ef4444',
  '180+ days': '#7c3aed',
};

function getBracketBadgeVariant(bracket: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (bracket.includes('180+')) return 'destructive';
  if (bracket.includes('91-180')) return 'destructive';
  if (bracket.includes('61-90')) return 'secondary';
  return 'default';
}

type BracketItem = NonNullable<InventoryAgingReport['brackets'][0]['items']>[0];

interface DrillDownSheetProps {
  isOpen: boolean;
  onClose: () => void;
  bracket: InventoryAgingReport['brackets'][0] | null;
}

function DrillDownSheet({ isOpen, onClose, bracket }: DrillDownSheetProps) {
  if (!bracket) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Badge variant={getBracketBadgeVariant(bracket.bracket)}>
              {bracket.bracket}
            </Badge>
            <span>Items</span>
          </SheetTitle>
          <SheetDescription>
            {bracket.itemCount} items with {formatCurrency(bracket.potentialRevenueImpact)} potential revenue
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">List Value</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bracket.items?.map((item: BracketItem) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{item.setNumber}</p>
                      <p className="text-sm text-muted-foreground truncate max-w-[180px]">
                        {item.itemName}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.condition}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium text-orange-600">
                    {item.daysInStock}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(item.cost)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(item.listingValue)}
                  </TableCell>
                  <TableCell>
                    <Link href={`/inventory/${item.id}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(!bracket.items || bracket.items.length === 0) && (
            <p className="text-center text-muted-foreground py-8">
              No items in this age bracket
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function InventoryAgingReportPage() {
  usePerfPage('InventoryAgingReportPage');

  const { data: report, isLoading, error } = useInventoryAgingReport();
  const exportMutation = useExportReport();
  const [selectedBracket, setSelectedBracket] = useState<InventoryAgingReport['brackets'][0] | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const handleExport = (format: 'csv' | 'json') => {
    exportMutation.mutate({
      reportType: 'inventory-aging',
      format,
    });
  };

  const handleBracketClick = (bracket: InventoryAgingReport['brackets'][0]) => {
    setSelectedBracket(bracket);
    setIsSheetOpen(true);
  };

  const handleBarClick = (data: { name?: string | number }) => {
    const bracketName = String(data.name || '');
    const bracket = report?.brackets.find((b) => b.bracket === bracketName);
    if (bracket) {
      handleBracketClick(bracket);
    }
  };

  // Prepare chart data
  const barChartData = report?.brackets.map((bracket) => ({
    name: bracket.bracket,
    items: bracket.itemCount,
    value: bracket.totalCostValue,
    color: BRACKET_COLORS[bracket.bracket] || '#6b7280',
  })) || [];

  const pieChartData = report?.brackets.map((bracket) => ({
    name: bracket.bracket,
    value: bracket.totalCostValue,
    color: BRACKET_COLORS[bracket.bracket] || '#6b7280',
  })) || [];

  // Calculate slow-moving inventory (91+ days)
  const slowMovingBrackets = report?.brackets.filter(
    (b) => b.bracket.includes('91-180') || b.bracket.includes('180+')
  ) || [];
  const slowMovingValue = slowMovingBrackets.reduce((sum, b) => sum + b.totalCostValue, 0);
  const slowMovingCount = slowMovingBrackets.reduce((sum, b) => sum + b.itemCount, 0);
  const slowMovingRevenue = slowMovingBrackets.reduce((sum, b) => sum + b.potentialRevenueImpact, 0);

  return (
    <>
      <Header title="Inventory Aging Report" />
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/reports">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Inventory Aging</h1>
              <p className="text-muted-foreground">
                Age bracket analysis to identify slow-moving stock
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => handleExport('csv')}
            disabled={exportMutation.isPending}
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
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
        ) : (
          <>
            {/* Key Metrics */}
            <div className="grid gap-4 md:grid-cols-5">
              <StatCard
                title="Total Items"
                value={report?.totalItems || 0}
                format="number"
                icon={<Clock className="h-4 w-4 text-muted-foreground" />}
              />
              <StatCard
                title="Total Value"
                value={report?.totalValue || 0}
                format="currency"
              />
              <StatCard
                title="Potential Revenue"
                value={report?.totalPotentialRevenue || 0}
                format="currency"
                icon={<DollarSign className="h-4 w-4 text-green-500" />}
              />
              <StatCard
                title="Avg Days in Stock"
                value={Math.round(report?.averageDaysInStock || 0)}
                format="number"
                description="Average age of inventory"
              />
              <StatCard
                title="Slow-Moving Stock"
                value={slowMovingValue}
                format="currency"
                description={`${slowMovingCount} items (91+ days)`}
                icon={<AlertTriangle className="h-4 w-4 text-orange-500" />}
              />
            </div>

            {/* Charts */}
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Items by Age Bracket</CardTitle>
                  <CardDescription>
                    Number of items in each age category. Click a bar to view items.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <BarChart
                    data={barChartData}
                    xAxisKey="name"
                    bars={[{ dataKey: 'items', name: 'Items', color: '#3b82f6' }]}
                    height={300}
                    colorByValue={(d) => d.color as string}
                    onBarClick={handleBarClick}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Value Distribution</CardTitle>
                  <CardDescription>Inventory value by age bracket</CardDescription>
                </CardHeader>
                <CardContent>
                  <PieChart
                    data={pieChartData}
                    height={300}
                    formatTooltip={(v) => formatCurrency(v)}
                  />
                </CardContent>
              </Card>
            </div>

            {/* Age Bracket Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Age Bracket Summary</CardTitle>
                <CardDescription>
                  Detailed breakdown by age category. Click a row to view items.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Age Bracket</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Total Value</TableHead>
                      <TableHead className="text-right">Potential Revenue</TableHead>
                      <TableHead className="text-right">% of Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report?.brackets.map((bracket) => (
                      <TableRow
                        key={bracket.bracket}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleBracketClick(bracket)}
                      >
                        <TableCell>
                          <Badge variant={getBracketBadgeVariant(bracket.bracket)}>
                            {bracket.bracket}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{bracket.itemCount}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(bracket.totalCostValue)}
                        </TableCell>
                        <TableCell className="text-right font-medium text-green-600">
                          {formatCurrency(bracket.potentialRevenueImpact)}
                        </TableCell>
                        <TableCell className="text-right">
                          {bracket.percentOfTotal.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Slow-Moving Items Alert */}
            {slowMovingCount > 0 && (
              <Card className="border-orange-200 bg-orange-50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-orange-800">
                    <AlertTriangle className="h-5 w-5" />
                    Slow-Moving Inventory Alert
                  </CardTitle>
                  <CardDescription className="text-orange-700">
                    You have {slowMovingCount} items worth {formatCurrency(slowMovingValue)} that
                    have been in stock for over 90 days, representing {formatCurrency(slowMovingRevenue)} in
                    potential revenue. Consider reviewing pricing or running promotions.
                  </CardDescription>
                </CardHeader>
              </Card>
            )}

            {/* Oldest Items - from 180+ days bracket */}
            {report?.brackets.find((b) => b.bracket.includes('180+'))?.items &&
             (report.brackets.find((b) => b.bracket.includes('180+'))?.items?.length ?? 0) > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Oldest Items in Stock</CardTitle>
                  <CardDescription>
                    Items that have been in inventory over 180 days
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Days in Stock</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">List Value</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.brackets
                        .find((b) => b.bracket.includes('180+'))
                        ?.items?.slice(0, 10)
                        .map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium">{item.setNumber}</p>
                                <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                                  {item.itemName}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{item.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium text-orange-600">
                              {item.daysInStock}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(item.cost)}
                            </TableCell>
                            <TableCell className="text-right font-medium text-green-600">
                              {formatCurrency(item.listingValue)}
                            </TableCell>
                            <TableCell>
                              <Link href={`/inventory/${item.id}`}>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Drill-down Sheet */}
      <DrillDownSheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        bracket={selectedBracket}
      />
    </>
  );
}
