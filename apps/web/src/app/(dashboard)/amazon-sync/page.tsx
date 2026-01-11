'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { CloudUpload, History } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TableSkeleton, StatCardSkeleton } from '@/components/ui/skeletons';
import {
  useAmazonSyncQueue,
  useSyncFeedHistory,
  useSyncFeed,
} from '@/hooks/use-amazon-sync';

// Dynamic imports with loading skeletons
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

const SyncQueueTable = dynamic(
  () =>
    import('@/components/features/amazon-sync').then((mod) => ({
      default: mod.SyncQueueTable,
    })),
  { ssr: false, loading: () => <TableSkeleton columns={8} rows={5} /> }
);

const SyncQueueSummary = dynamic(
  () =>
    import('@/components/features/amazon-sync').then((mod) => ({
      default: mod.SyncQueueSummary,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-4 md:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
    ),
  }
);

const SyncQueueEmptyState = dynamic(
  () =>
    import('@/components/features/amazon-sync').then((mod) => ({
      default: mod.SyncQueueEmptyState,
    })),
  { ssr: false }
);

const SyncSubmitControls = dynamic(
  () =>
    import('@/components/features/amazon-sync').then((mod) => ({
      default: mod.SyncSubmitControls,
    })),
  { ssr: false }
);

const SyncFeedHistoryTable = dynamic(
  () =>
    import('@/components/features/amazon-sync').then((mod) => ({
      default: mod.SyncFeedHistoryTable,
    })),
  { ssr: false, loading: () => <TableSkeleton columns={6} rows={5} /> }
);

const SyncFeedStatus = dynamic(
  () =>
    import('@/components/features/amazon-sync').then((mod) => ({
      default: mod.SyncFeedStatus,
    })),
  { ssr: false }
);

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================

export default function AmazonSyncPage() {
  const [activeTab, setActiveTab] = useState('queue');
  const [activeFeedId, setActiveFeedId] = useState<string | null>(null);

  // Fetch queue data
  const {
    data: queueData,
    isLoading: isLoadingQueue,
  } = useAmazonSyncQueue();

  // Fetch feed history
  const { data: feeds, isLoading: isLoadingFeeds } = useSyncFeedHistory(20);

  // Fetch active feed if one is selected
  const { data: activeFeed } = useSyncFeed(activeFeedId ?? undefined, {
    enabled: !!activeFeedId,
    pollWhileProcessing: true,
  });

  // Handle feed creation - switch to history tab and track the feed
  const handleFeedCreated = (feedId: string) => {
    setActiveFeedId(feedId);
    setActiveTab('history');
  };

  const queueCount = queueData?.summary.totalItems ?? 0;
  const uniqueAsins = queueData?.summary.uniqueAsins ?? 0;

  return (
    <>
      <Header />
      <div className="p-6 space-y-6">
        {/* Page Title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              Amazon Sync
              {queueCount > 0 && (
                <Badge variant="secondary">{queueCount} queued</Badge>
              )}
            </h1>
            <p className="text-muted-foreground">
              Push price and quantity updates to Amazon
            </p>
          </div>
        </div>

        {/* Active Feed Banner */}
        {activeFeed &&
          ['submitted', 'processing'].includes(activeFeed.status) && (
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-blue-500/10 p-2">
                      <CloudUpload className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                      <p className="font-medium">Feed in Progress</p>
                      <p className="text-sm text-muted-foreground">
                        {activeFeed.total_items} items being processed
                      </p>
                    </div>
                  </div>
                  <SyncFeedStatus feed={activeFeed} showPollButton />
                </div>
              </CardContent>
            </Card>
          )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="queue" className="flex items-center gap-2">
              <CloudUpload className="h-4 w-4" />
              Queue
              {queueCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {queueCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              History
            </TabsTrigger>
          </TabsList>

          {/* Queue Tab */}
          <TabsContent value="queue" className="space-y-6">
            {queueCount > 0 ? (
              <>
                {/* Summary Cards */}
                <SyncQueueSummary
                  totalItems={queueData?.summary.totalItems ?? 0}
                  uniqueAsins={queueData?.summary.uniqueAsins ?? 0}
                  totalQuantity={queueData?.summary.totalQuantity ?? 0}
                  aggregated={queueData?.aggregated ?? []}
                />

                {/* Submit Controls */}
                <Card>
                  <CardContent className="p-4">
                    <SyncSubmitControls
                      queueCount={queueCount}
                      uniqueAsins={uniqueAsins}
                      onFeedCreated={handleFeedCreated}
                    />
                  </CardContent>
                </Card>

                {/* Queue Table */}
                <Card>
                  <CardHeader>
                    <CardTitle>Queue Items</CardTitle>
                    <CardDescription>
                      Items waiting to be synced to Amazon. Multiple items with
                      the same ASIN will be aggregated.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <SyncQueueTable
                      items={queueData?.items ?? []}
                      isLoading={isLoadingQueue}
                    />
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent>
                  <SyncQueueEmptyState />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Feed History</CardTitle>
                <CardDescription>
                  Recent feed submissions and their results
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SyncFeedHistoryTable
                  feeds={feeds ?? []}
                  isLoading={isLoadingFeeds}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
