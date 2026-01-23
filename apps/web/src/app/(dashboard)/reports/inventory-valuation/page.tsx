'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, Download, Loader2, Package } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { StatCard, PieChart } from '@/components/charts';
import { useInventoryValuationReport, useExportReport } from '@/hooks/use-reports';
import { usePerfPage } from '@/hooks/use-perf';

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

export default function InventoryValuationReportPage() {
  usePerfPage('InventoryValuationReportPage');

  const { data: report, isLoading, error } = useInventoryValuationReport();
  const exportMutation = useExportReport();

  const handleExport = (format: 'csv' | 'json') => {
    exportMutation.mutate({
      reportType: 'inventory-valuation',
      format,
    });
  };

  // Prepare chart data by condition
  const conditionData = report?.byCondition
    ? report.byCondition.map((c) => ({
        name: c.condition,
        value: c.costValue,
        color: c.condition.toLowerCase() === 'new' ? '#10b981' : '#f59e0b',
      })).filter((d) => d.value > 0)
    : [];

  return (
    <>
      <Header title="Inventory Valuation Report" />
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
              <h1 className="text-2xl font-bold">Inventory Valuation</h1>
              <p className="text-muted-foreground">
                Current stock value at cost and estimated sale price
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
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard
                title="Total Items"
                value={report?.summary.totalItems || 0}
                format="number"
                icon={<Package className="h-4 w-4 text-muted-foreground" />}
              />
              <StatCard
                title="Total Cost Value"
                value={report?.summary.totalCostValue || 0}
                format="currency"
                description="At purchase cost"
              />
              <StatCard
                title="Estimated Sale Value"
                value={report?.summary.estimatedSaleValue || 0}
                format="currency"
                description="At current market prices"
              />
              <StatCard
                title="Potential Profit"
                value={report?.summary.potentialProfit || 0}
                format="currency"
                trend={(report?.summary.potentialProfit || 0) > 0 ? 'up' : 'down'}
              />
            </div>

            {/* Additional Metrics */}
            <div className="grid gap-4 md:grid-cols-2">
              <StatCard
                title="Potential Margin"
                value={report?.summary.potentialMargin || 0}
                format="percent"
              />
              <StatCard
                title="Unique SKUs"
                value={report?.summary.totalItems || 0}
                format="number"
              />
            </div>

            {/* Charts & Table */}
            <div className="grid gap-6 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Value by Condition</CardTitle>
                  <CardDescription>Distribution of inventory value</CardDescription>
                </CardHeader>
                <CardContent>
                  <PieChart
                    data={conditionData}
                    height={250}
                    formatTooltip={(v) => formatCurrency(v)}
                  />
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Top Items by Value</CardTitle>
                  <CardDescription>
                    Highest value items in your inventory
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Condition</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">Listing</TableHead>
                        <TableHead className="text-right">Potential</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report?.topValueItems
                        .slice(0, 10)
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
                              <Badge
                                variant={
                                  item.condition.toLowerCase() === 'new'
                                    ? 'default'
                                    : 'secondary'
                                }
                              >
                                {item.condition}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{item.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(item.cost)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(item.listingValue)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${
                                item.potentialProfit >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}
                            >
                              {formatCurrency(item.potentialProfit)}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* By Condition Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Breakdown by Condition</CardTitle>
                <CardDescription>
                  Value distribution across item conditions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Condition</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Cost Value</TableHead>
                      <TableHead className="text-right">Sale Value</TableHead>
                      <TableHead className="text-right">Potential Profit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report?.byCondition.map((condition) => (
                      <TableRow key={condition.condition}>
                        <TableCell>
                          <Badge
                            variant={
                              condition.condition.toLowerCase() === 'new'
                                ? 'default'
                                : 'secondary'
                            }
                          >
                            {condition.condition}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{condition.itemCount}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(condition.costValue)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(condition.saleValue)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-medium ${
                            condition.potentialProfit >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {formatCurrency(condition.potentialProfit)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* By Status Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Breakdown by Status</CardTitle>
                <CardDescription>
                  Value distribution across item statuses
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Cost Value</TableHead>
                      <TableHead className="text-right">Sale Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report?.byStatus.map((status) => (
                      <TableRow key={status.status}>
                        <TableCell>
                          <Badge variant="outline">{status.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{status.itemCount}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(status.costValue)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(status.saleValue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
