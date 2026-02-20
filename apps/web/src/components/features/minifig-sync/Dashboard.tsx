'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Package,
  TrendingUp,
  DollarSign,
  Clock,
  AlertCircle,
  Send,
  ShoppingCart,
  BarChart3,
  Download,
  Search,
  FileText,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useMinifigDashboard,
  useInventoryPull,
  useResearch,
  useCreateListings,
} from '@/hooks/use-minifig-sync';

function formatCurrency(value: number): string {
  return `£${value.toFixed(2)}`;
}

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
}

function StatCard({ title, value, description, icon: Icon, href }: StatCardProps) {
  const content = (
    <Card className={href ? 'hover:bg-muted/50 transition-colors cursor-pointer' : ''}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

export function MinifigDashboard() {
  const { data, isLoading } = useMinifigDashboard();
  const inventoryPull = useInventoryPull();
  const research = useResearch();
  const createListings = useCreateListings();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-32 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Failed to load dashboard data
      </div>
    );
  }

  const stagedCount = data.countByStatus['STAGED'] ?? 0;
  const publishedCount = data.countByStatus['PUBLISHED'] ?? 0;
  const soldEbayCount = (data.countByStatus['SOLD_EBAY'] ?? 0) + (data.countByStatus['SOLD_EBAY_PENDING_REMOVAL'] ?? 0);
  const soldBricqerCount = (data.countByStatus['SOLD_BRICQER'] ?? 0) + (data.countByStatus['SOLD_BRICQER_PENDING_REMOVAL'] ?? 0);
  const totalSold = soldEbayCount + soldBricqerCount;

  return (
    <div className="space-y-6">
      {/* Pipeline actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="default"
          disabled={inventoryPull.isPending}
          onClick={() => {
            inventoryPull.mutate(undefined, {
              onSuccess: (result) => {
                toast.success(`Inventory pull complete: ${result.itemsCreated} new, ${result.itemsUpdated} updated`);
              },
              onError: (err) => {
                toast.error(`Inventory pull failed: ${err.message}`);
              },
            });
          }}
        >
          {inventoryPull.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Pull Inventory
        </Button>
        <Button
          variant="default"
          disabled={research.isPending}
          onClick={() => {
            research.mutate(undefined, {
              onSuccess: (result) => {
                toast.success(`Research complete: ${result.itemsProcessed} items, ${result.itemsUpdated} updated`);
              },
              onError: (err) => {
                toast.error(`Research failed: ${err.message}`);
              },
            });
          }}
        >
          {research.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
          Research
        </Button>
        <Button
          variant="default"
          disabled={createListings.isPending}
          onClick={() => {
            createListings.mutate(undefined, {
              onSuccess: (result) => {
                toast.success(`Listings created: ${result.itemsStaged} staged, ${result.itemsSkipped} skipped`);
              },
              onError: (err) => {
                toast.error(`Create listings failed: ${err.message}`);
              },
            });
          }}
        >
          {createListings.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
          Create Listings
        </Button>

        <div className="w-px bg-border mx-1" />

        <Button asChild variant="outline">
          <Link href="/minifigs/review">
            <Send className="h-4 w-4 mr-2" />
            Review Queue
            {stagedCount > 0 && (
              <Badge variant="secondary" className="ml-2">{stagedCount}</Badge>
            )}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/minifigs/removals">
            <AlertCircle className="h-4 w-4 mr-2" />
            Removal Queue
            {data.pendingRemovals > 0 && (
              <Badge variant="destructive" className="ml-2">{data.pendingRemovals}</Badge>
            )}
          </Link>
        </Button>
      </div>

      {/* Stats grid (F68) */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total in Bricqer"
          value={data.totalInBricqer}
          description="Minifigures in inventory"
          icon={Package}
        />
        <StatCard
          title="Meeting Threshold"
          value={data.totalMeetingThreshold}
          description={`${data.totalInBricqer > 0 ? Math.round((data.totalMeetingThreshold / data.totalInBricqer) * 100) : 0}% of inventory`}
          icon={TrendingUp}
        />
        <StatCard
          title="Staged"
          value={stagedCount}
          description="Awaiting review"
          icon={BarChart3}
          href="/minifigs/review"
        />
        <StatCard
          title="Published"
          value={publishedCount}
          description="Live on eBay"
          icon={Send}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Sold"
          value={totalSold}
          description={`eBay: ${soldEbayCount} | Bricqer: ${soldBricqerCount}`}
          icon={ShoppingCart}
        />
        <StatCard
          title="Revenue"
          value={formatCurrency(data.totalRevenue)}
          description="From all minifig sales"
          icon={DollarSign}
        />
        <StatCard
          title="Fee Savings"
          value={formatCurrency(data.feeSavings)}
          description="3.5% Bricqer fee avoided"
          icon={DollarSign}
        />
        <StatCard
          title="Avg Time to Sell"
          value={data.avgTimeToSell != null ? `${data.avgTimeToSell} days` : '-'}
          description="From listing to sale"
          icon={Clock}
        />
      </div>

      {/* Status breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.countByStatus).map(([status, count]) => (
              <Badge key={status} variant="outline" className="text-xs">
                {status.replace(/_/g, ' ')}: {count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
