'use client';

import React, { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { PenLine, Image as ImageIcon, FileText, History, RefreshCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useListingCounts } from '@/hooks/listing-assistant';

// Lazy load tab components
const GeneratorTab = React.lazy(() =>
  import('./tabs/GeneratorTab').then((m) => ({ default: m.GeneratorTab }))
);
const ImageStudioTab = React.lazy(() =>
  import('./tabs/ImageStudioTab').then((m) => ({ default: m.ImageStudioTab }))
);
const TemplatesTab = React.lazy(() =>
  import('./tabs/TemplatesTab').then((m) => ({ default: m.TemplatesTab }))
);
const HistoryTab = React.lazy(() =>
  import('./tabs/HistoryTab').then((m) => ({ default: m.HistoryTab }))
);
const RefreshTab = React.lazy(() =>
  import('./tabs/RefreshTab').then((m) => ({ default: m.RefreshTab }))
);

type TabValue = 'create' | 'studio' | 'templates' | 'history' | 'refresh';

interface TabConfig {
  value: TabValue;
  label: string;
  icon: React.ReactNode;
}

const tabs: TabConfig[] = [
  { value: 'create', label: 'Create Listing', icon: <PenLine className="h-4 w-4" aria-hidden="true" /> },
  { value: 'studio', label: 'Image Studio', icon: <ImageIcon className="h-4 w-4" aria-hidden="true" /> },
  { value: 'templates', label: 'Templates', icon: <FileText className="h-4 w-4" aria-hidden="true" /> },
  { value: 'refresh', label: 'Refresh', icon: <RefreshCw className="h-4 w-4" aria-hidden="true" /> },
  { value: 'history', label: 'History', icon: <History className="h-4 w-4" aria-hidden="true" /> },
];

function TabLoadingFallback() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function ListingAssistantTabs() {
  const searchParams = useSearchParams();
  const inventoryId = searchParams.get('inventoryId');
  const [activeTab, setActiveTab] = useState<TabValue>('create');

  // Get listing counts for the History badge
  const { data: counts } = useListingCounts();
  const historyCount = counts?.total || 0;

  // If there's an inventoryId, switch to the create tab
  useEffect(() => {
    if (inventoryId) {
      setActiveTab('create');
    }
  }, [inventoryId]);

  return (
    <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as TabValue)}>
      <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="flex items-center gap-2"
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.value === 'history' && historyCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {historyCount}
              </Badge>
            )}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="create" className="mt-6">
        <Suspense fallback={<TabLoadingFallback />}>
          <GeneratorTab inventoryItemId={inventoryId} />
        </Suspense>
      </TabsContent>

      <TabsContent value="studio" className="mt-6">
        <Suspense fallback={<TabLoadingFallback />}>
          <ImageStudioTab />
        </Suspense>
      </TabsContent>

      <TabsContent value="templates" className="mt-6">
        <Suspense fallback={<TabLoadingFallback />}>
          <TemplatesTab />
        </Suspense>
      </TabsContent>

      <TabsContent value="refresh" className="mt-6">
        <Suspense fallback={<TabLoadingFallback />}>
          <RefreshTab />
        </Suspense>
      </TabsContent>

      <TabsContent value="history" className="mt-6">
        <Suspense fallback={<TabLoadingFallback />}>
          <HistoryTab />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
