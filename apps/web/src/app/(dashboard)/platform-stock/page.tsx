'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  PlatformStockHeader,
  ListingsView,
  ComparisonView,
  ImportStatusBanner,
} from '@/components/features/platform-stock';
import { RepricingView } from '@/components/features/repricing';
import {
  usePlatformListings,
  useTriggerImport,
} from '@/hooks/use-platform-stock';

// Dynamic import for Header to avoid SSR issues
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

type TabValue = 'listings' | 'comparison' | 'repricing';

export default function PlatformStockPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabValue>('listings');
  const platform = 'amazon'; // Currently only Amazon is supported

  // Get latest import for header
  const { data: listingsData } = usePlatformListings(platform, {}, 1, 1);

  // Import mutation
  const importMutation = useTriggerImport(platform);

  const handleRefresh = async () => {
    try {
      await importMutation.mutateAsync();
      toast({
        title: 'Import completed',
        description: 'Amazon listings have been imported successfully.',
      });
    } catch (error) {
      toast({
        title: 'Import failed',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to import listings from Amazon.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Header title="Amazon Stock" />
      <div className="p-6 space-y-6">
        <PlatformStockHeader
          platform={platform}
          latestImport={listingsData?.latestImport}
          onRefresh={handleRefresh}
          isRefreshing={importMutation.isPending}
        />

        {importMutation.isPending && (
          <ImportStatusBanner isImporting />
        )}

        {importMutation.isError && (
          <ImportStatusBanner
            import={{
              id: '',
              userId: '',
              platform: 'amazon',
              importType: 'full',
              status: 'failed',
              totalRows: null,
              processedRows: 0,
              errorCount: 0,
              amazonReportId: null,
              amazonReportDocumentId: null,
              amazonReportType: null,
              startedAt: null,
              completedAt: null,
              errorMessage: importMutation.error?.message || 'Import failed',
              errorDetails: null,
              createdAt: new Date().toISOString(),
            }}
          />
        )}

        <Tabs
          value={activeTab}
          onValueChange={(v: string) => setActiveTab(v as TabValue)}
        >
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="listings">Listings</TabsTrigger>
            <TabsTrigger value="comparison">Comparison</TabsTrigger>
            <TabsTrigger value="repricing">Repricing</TabsTrigger>
          </TabsList>

          <TabsContent value="listings" className="mt-6">
            <ListingsView platform={platform} />
          </TabsContent>

          <TabsContent value="comparison" className="mt-6">
            <ComparisonView platform={platform} />
          </TabsContent>

          <TabsContent value="repricing" className="mt-6">
            <RepricingView platform={platform} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
