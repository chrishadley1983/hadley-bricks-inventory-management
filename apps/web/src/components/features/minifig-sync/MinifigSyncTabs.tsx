'use client';

import React, { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { LayoutDashboard, Package, CloudUpload, Layers } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';

const DashboardTab = React.lazy(() =>
  import('./Dashboard').then((m) => ({ default: m.MinifigDashboard }))
);
const ItemsTab = React.lazy(() =>
  import('./MinifigItemsTable').then((m) => ({ default: m.MinifigItemsTable }))
);
const ReviewTab = React.lazy(() =>
  import('./SingleListingReview').then((m) => ({ default: m.SingleListingReview }))
);
const RemovalsTab = React.lazy(() =>
  import('./RemovalQueue').then((m) => ({ default: m.RemovalQueue }))
);

type TabValue = 'dashboard' | 'items' | 'review' | 'removals';

interface TabConfig {
  value: TabValue;
  label: string;
  icon: React.ReactNode;
}

const tabs: TabConfig[] = [
  {
    value: 'dashboard',
    label: 'Dashboard',
    icon: <LayoutDashboard className="h-4 w-4" aria-hidden="true" />,
  },
  { value: 'items', label: 'Items', icon: <Package className="h-4 w-4" aria-hidden="true" /> },
  {
    value: 'review',
    label: 'Review',
    icon: <CloudUpload className="h-4 w-4" aria-hidden="true" />,
  },
  { value: 'removals', label: 'Removals', icon: <Layers className="h-4 w-4" aria-hidden="true" /> },
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

export function MinifigSyncTabs() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab') as TabValue | null;
  const [activeTab, setActiveTab] = useState<TabValue>(tabParam || 'dashboard');

  useEffect(() => {
    if (tabParam && tabs.some((t) => t.value === tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = (value: string) => {
    const newTab = value as TabValue;
    setActiveTab(newTab);
    // Update URL without full navigation
    const url = new URL(window.location.href);
    if (newTab === 'dashboard') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', newTab);
    }
    window.history.replaceState({}, '', url.toString());
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="flex items-center gap-2">
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="dashboard" className="mt-6">
        <Suspense fallback={<TabLoadingFallback />}>
          <DashboardTab />
        </Suspense>
      </TabsContent>

      <TabsContent value="items" className="mt-6">
        <Suspense fallback={<TabLoadingFallback />}>
          <ItemsTab />
        </Suspense>
      </TabsContent>

      <TabsContent value="review" className="mt-6">
        <Suspense fallback={<TabLoadingFallback />}>
          <ReviewTab />
        </Suspense>
      </TabsContent>

      <TabsContent value="removals" className="mt-6">
        <Suspense fallback={<TabLoadingFallback />}>
          <RemovalsTab />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
