'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Plus,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingCart,
  Loader2,
  Search,
  Filter,
  CalendarDays,
} from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

interface Sale {
  id: string;
  sale_date: string;
  platform: string | null;
  sale_amount: number;
  shipping_charged: number | null;
  platform_fees: number | null;
  shipping_cost: number | null;
  other_costs: number | null;
  cost_of_goods: number | null;
  net_revenue: number | null;
  gross_profit: number | null;
  buyer_name: string | null;
  description: string | null;
  order_id: string | null;
}

interface SalesStats {
  totalSales: number;
  totalRevenue: number;
  totalProfit: number;
  averageMargin: number;
  averageOrderValue: number;
}

interface SalesResponse {
  data: Sale[];
  total: number;
}

interface StatsResponse {
  data: SalesStats;
}

async function fetchSales(
  platform?: string,
  startDate?: string,
  endDate?: string
): Promise<SalesResponse> {
  const params = new URLSearchParams();
  if (platform && platform !== 'all') params.set('platform', platform);
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  params.set('limit', '100');

  const response = await fetch(`/api/sales?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch sales');
  return response.json();
}

async function fetchStats(
  startDate?: string,
  endDate?: string
): Promise<StatsResponse> {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  const response = await fetch(`/api/sales/stats?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch stats');
  return response.json();
}

function formatCurrency(amount: number | null, currency = 'GBP'): string {
  if (amount === null) return '-';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amount);
}

function getPlatformColor(platform: string | null): string {
  switch (platform?.toLowerCase()) {
    case 'bricklink':
      return 'bg-blue-100 text-blue-800';
    case 'brickowl':
      return 'bg-orange-100 text-orange-800';
    case 'ebay':
      return 'bg-yellow-100 text-yellow-800';
    case 'amazon':
      return 'bg-amber-100 text-amber-800';
    case 'manual':
      return 'bg-gray-100 text-gray-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export default function SalesPage() {
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<string>('30');

  // Calculate date range
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(
    Date.now() - parseInt(dateRange) * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .split('T')[0];

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['sales', platformFilter, dateRange],
    queryFn: () =>
      fetchSales(
        platformFilter !== 'all' ? platformFilter : undefined,
        dateRange !== 'all' ? startDate : undefined,
        dateRange !== 'all' ? endDate : undefined
      ),
  });

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['sales-stats', dateRange],
    queryFn: () =>
      fetchStats(
        dateRange !== 'all' ? startDate : undefined,
        dateRange !== 'all' ? endDate : undefined
      ),
  });

  const sales = salesData?.data || [];
  const stats = statsData?.data;

  // Filter by search query
  const filteredSales = sales.filter((sale) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      sale.buyer_name?.toLowerCase().includes(query) ||
      sale.description?.toLowerCase().includes(query) ||
      sale.platform?.toLowerCase().includes(query)
    );
  });

  return (
    <>
      <Header title="Sales" />
      <div className="p-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{stats?.totalSales || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {dateRange === 'all' ? 'All time' : `Last ${dateRange} days`}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    {formatCurrency(stats?.totalRevenue || 0)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Avg: {formatCurrency(stats?.averageOrderValue || 0)}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Profit</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    {formatCurrency(stats?.totalProfit || 0)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    After all costs
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Margin</CardTitle>
              {(stats?.averageMargin || 0) >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    {(stats?.averageMargin || 0).toFixed(1)}%
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Gross profit margin
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Filters & Actions */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search sales..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-[200px]"
              />
            </div>

            <Select value={platformFilter} onValueChange={setPlatformFilter}>
              <SelectTrigger className="w-[150px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                <SelectItem value="bricklink">BrickLink</SelectItem>
                <SelectItem value="brickowl">BrickOwl</SelectItem>
                <SelectItem value="ebay">eBay</SelectItem>
                <SelectItem value="amazon">Amazon</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>

            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[150px]">
                <CalendarDays className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last year</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Link href="/sales/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Manual Sale
            </Button>
          </Link>
        </div>

        {/* Sales Table */}
        <Card>
          <CardHeader>
            <CardTitle>Sales History</CardTitle>
            <CardDescription>
              {filteredSales.length} sale{filteredSales.length !== 1 ? 's' : ''} found
            </CardDescription>
          </CardHeader>
          <CardContent>
            {salesLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : filteredSales.length === 0 ? (
              <div className="text-center py-12">
                <ShoppingCart className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-2 text-lg font-semibold">No sales found</h3>
                <p className="text-muted-foreground">
                  {searchQuery || platformFilter !== 'all'
                    ? 'Try adjusting your filters'
                    : 'Record your first sale to get started'}
                </p>
                {!searchQuery && platformFilter === 'all' && (
                  <Link href="/sales/new">
                    <Button className="mt-4">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Manual Sale
                    </Button>
                  </Link>
                )}
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead>Customer / Description</TableHead>
                      <TableHead className="text-right">Sale Amount</TableHead>
                      <TableHead className="text-right">Costs</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSales.map((sale) => {
                      const totalCosts =
                        (sale.platform_fees || 0) +
                        (sale.shipping_cost || 0) +
                        (sale.other_costs || 0) +
                        (sale.cost_of_goods || 0);
                      const margin =
                        sale.sale_amount > 0
                          ? ((sale.gross_profit || 0) / sale.sale_amount) * 100
                          : 0;

                      return (
                        <TableRow key={sale.id}>
                          <TableCell>
                            <div className="font-medium">
                              {format(new Date(sale.sale_date), 'MMM d, yyyy')}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={getPlatformColor(sale.platform)}>
                              {sale.platform || 'Unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div>
                              {sale.buyer_name && (
                                <p className="font-medium">{sale.buyer_name}</p>
                              )}
                              {sale.description && (
                                <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                                  {sale.description}
                                </p>
                              )}
                              {!sale.buyer_name && !sale.description && (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div>
                              <p className="font-medium">
                                {formatCurrency(sale.sale_amount)}
                              </p>
                              {(sale.shipping_charged || 0) > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  + {formatCurrency(sale.shipping_charged)} shipping
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatCurrency(totalCosts)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span
                              className={
                                (sale.gross_profit || 0) >= 0
                                  ? 'text-green-600 font-medium'
                                  : 'text-red-600 font-medium'
                              }
                            >
                              {formatCurrency(sale.gross_profit)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span
                              className={
                                margin >= 0
                                  ? 'text-green-600'
                                  : 'text-red-600'
                              }
                            >
                              {margin.toFixed(1)}%
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
