'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  EbayStockHeader,
  EbayListingsView,
  EbayComparisonView,
  SkuIssuesBanner,
} from '@/components/features/ebay-stock';
import { ImportStatusBanner } from '@/components/features/platform-stock/ImportStatusBanner';
import { useEbayListings, useTriggerEbayImport } from '@/hooks/use-ebay-stock';
import { usePerfPage } from '@/hooks/use-perf';

// Dynamic import for Header to avoid SSR issues
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

type TabValue = 'listings' | 'comparison';

export default function EbayStockPage() {
  usePerfPage('EbayStockPage');
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabValue>('listings');

  // Get latest import for header
  const { data: listingsData } = useEbayListings({}, 1, 1);

  // Import mutation
  const importMutation = useTriggerEbayImport();

  const handleRefresh = async () => {
    try {
      await importMutation.mutateAsync();
      toast({
        title: 'Import completed',
        description: 'eBay listings have been imported successfully.',
      });
    } catch (error) {
      toast({
        title: 'Import failed',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to import listings from eBay.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Header title="eBay Stock" />
      <div className="p-6 space-y-6">
        <EbayStockHeader
          latestImport={listingsData?.latestImport || null}
          onRefresh={handleRefresh}
          isRefreshing={importMutation.isPending}
        />

        {importMutation.isPending && <ImportStatusBanner isImporting platform="ebay" />}

        {importMutation.isError && (
          <ImportStatusBanner
            platform="ebay"
            import={{
              id: '',
              userId: '',
              platform: 'ebay',
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

        {/* SKU Issues Banner */}
        <SkuIssuesBanner />

        <Tabs
          value={activeTab}
          onValueChange={(v: string) => setActiveTab(v as TabValue)}
        >
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="listings">eBay Listings</TabsTrigger>
            <TabsTrigger value="comparison">Stock Comparison</TabsTrigger>
          </TabsList>

          <TabsContent value="listings" className="mt-6">
            <EbayListingsView />
          </TabsContent>

          <TabsContent value="comparison" className="mt-6">
            <EbayComparisonView />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
