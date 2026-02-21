'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Package,
  AlertCircle,
  Clock,
  CheckCircle2,
  ExternalLink,
  ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PickingListDialog } from './PickingListDialog';
import type { PickingListPlatform } from '@/hooks/use-picking-list';

interface OrderWithDeadline {
  id: string;
  platformOrderId: string;
  buyerName: string | null;
  itemName: string | null;
  total: number;
  currency: string;
  dispatchBy: string;
  isOverdue: boolean;
  isUrgent: boolean;
  itemCount: number;
  platform: string;
}

interface PlatformGroup {
  platform: string;
  orders: OrderWithDeadline[];
  orderCount: number;
  earliestDeadline: string | null;
}

interface DispatchDeadlinesResponse {
  platforms: PlatformGroup[];
  overdueCount: number;
  urgentCount: number;
}

async function fetchDispatchDeadlines(): Promise<DispatchDeadlinesResponse> {
  const response = await fetch('/api/orders/dispatch-deadlines');
  if (!response.ok) {
    throw new Error('Failed to fetch dispatch deadlines');
  }
  return response.json();
}

function formatTimeRemaining(dispatchBy: string, isOverdue: boolean): string {
  if (isOverdue) return 'Overdue';

  const now = new Date();
  const deadline = new Date(dispatchBy);
  const diffMs = deadline.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffHours >= 24) {
    const days = Math.floor(diffHours / 24);
    return `${days}d ${diffHours % 24}h`;
  }
  if (diffHours > 0) {
    return `${diffHours}h ${diffMins}m`;
  }
  return `${diffMins}m`;
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency || 'GBP',
  }).format(amount);
}

const platformLabels: Record<string, string> = {
  ebay: 'eBay',
  amazon: 'Amazon',
  bricklink: 'BrickLink',
  brickowl: 'Brick Owl',
  other: 'Other',
};

interface OrdersDispatchPanelProps {
  className?: string;
}

// Platforms that support picking list generation
const pickingListPlatforms: PickingListPlatform[] = ['amazon', 'ebay'];

export function OrdersDispatchPanel({ className }: OrdersDispatchPanelProps) {
  const [pickingListPlatform, setPickingListPlatform] = useState<PickingListPlatform | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['dispatch-deadlines'],
    queryFn: fetchDispatchDeadlines,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            Orders to Dispatch
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            Orders to Dispatch
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Failed to load dispatch deadlines</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const platforms = data?.platforms ?? [];
  const totalOrders = platforms.reduce((sum, p) => sum + p.orderCount, 0);
  const overdueCount = data?.overdueCount ?? 0;
  const urgentCount = data?.urgentCount ?? 0;

  if (totalOrders === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            Orders to Dispatch
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500 mb-2" />
            <p className="text-sm text-muted-foreground">No orders awaiting dispatch</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            Orders to Dispatch
            <Badge variant={overdueCount > 0 ? 'destructive' : 'secondary'}>{totalOrders}</Badge>
          </CardTitle>
          <div className="flex gap-2">
            {overdueCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {overdueCount} overdue
              </Badge>
            )}
            {urgentCount > 0 && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-500">
                {urgentCount} urgent
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <Tabs defaultValue={platforms[0]?.platform || 'ebay'} className="w-full">
          <TabsList className="w-full justify-start">
            {platforms.map((group) => (
              <TabsTrigger
                key={group.platform}
                value={group.platform}
                className="flex items-center gap-1"
              >
                {platformLabels[group.platform] || group.platform}
                <Badge variant="secondary" className="ml-1 text-xs">
                  {group.orderCount}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          {platforms.map((group) => (
            <TabsContent key={group.platform} value={group.platform} className="mt-3">
              <div className="space-y-2 max-h-[250px] overflow-y-auto">
                {group.orders.map((order) => (
                  <div
                    key={order.id}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-lg border',
                      order.isOverdue &&
                        'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900',
                      order.isUrgent &&
                        !order.isOverdue &&
                        'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {order.platformOrderId}
                        </span>
                        <Link
                          href={`/orders?search=${order.platformOrderId}`}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {order.itemName || order.buyerName || 'Unknown'} &middot; {order.itemCount}{' '}
                        {order.itemCount === 1 ? 'item' : 'items'} &middot;{' '}
                        {formatCurrency(order.total, order.currency)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          order.isOverdue ? 'destructive' : order.isUrgent ? 'outline' : 'secondary'
                        }
                        className={cn(
                          'text-xs',
                          order.isUrgent && !order.isOverdue && 'text-amber-600 border-amber-500'
                        )}
                      >
                        <Clock className="h-3 w-3 mr-1" />
                        {formatTimeRemaining(order.dispatchBy, order.isOverdue)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t">
                {pickingListPlatforms.includes(group.platform as PickingListPlatform) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setPickingListPlatform(group.platform as PickingListPlatform)}
                  >
                    <ClipboardList className="h-4 w-4 mr-2" />
                    Generate Picking List
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" asChild className="w-full">
                    <Link href={`/orders?platform=${group.platform}&status=Paid`}>View Orders</Link>
                  </Button>
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>

      {/* Picking List Dialog */}
      {pickingListPlatform && (
        <PickingListDialog
          open={!!pickingListPlatform}
          onOpenChange={(open) => !open && setPickingListPlatform(null)}
          platform={pickingListPlatform}
        />
      )}
    </Card>
  );
}
