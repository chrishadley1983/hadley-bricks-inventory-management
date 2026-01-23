'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Plus, RefreshCw, Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBrickLinkUploadSyncStatus, useTriggerBatchSync } from '@/hooks/use-bricklink-uploads';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { usePerfPage } from '@/hooks/use-perf';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

const BrickLinkUploadTable = dynamic(
  () =>
    import('@/components/features/bricklink-uploads').then((mod) => ({
      default: mod.BrickLinkUploadTable,
    })),
  { ssr: false }
);

export default function BrickLinkUploadsPage() {
  usePerfPage('BrickLinkUploadsPage');
  const [isSyncing, setIsSyncing] = useState(false);
  const { data: syncStatus } = useBrickLinkUploadSyncStatus();
  const syncMutation = useTriggerBatchSync();

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await syncMutation.mutateAsync({});
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <>
      <Header title="BrickLink Uploads" />
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">BrickLink Uploads</h2>
              <p className="text-muted-foreground">
                Track inventory batches uploaded to BrickLink/BrickOwl stores
              </p>
            </div>
            {syncStatus?.isConnected && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1">
                  <Cloud className="h-3 w-3" />
                  Bricqer Connected
                </Badge>
                {syncStatus.lastSyncAt && (
                  <span className="text-xs text-muted-foreground">
                    Last sync: {formatDate(syncStatus.lastSyncAt)}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {syncStatus?.isConnected && (
              <Button
                variant="outline"
                onClick={handleSync}
                disabled={isSyncing || syncMutation.isPending}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing...' : 'Sync from Bricqer'}
              </Button>
            )}
            <Button asChild>
              <Link href="/bricklink-uploads/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Upload
              </Link>
            </Button>
          </div>
        </div>

        <BrickLinkUploadTable />
      </div>
    </>
  );
}
