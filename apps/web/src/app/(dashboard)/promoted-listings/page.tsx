'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PromotedAdsView } from '@/components/features/promoted-listings/PromotedAdsView';
import { ScheduleConfigView } from '@/components/features/promoted-listings/ScheduleConfigView';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

type TabValue = 'ads' | 'schedule';

export default function PromotedListingsPage() {
  const [activeTab, setActiveTab] = useState<TabValue>('ads');

  return (
    <>
      <Header title="Promoted Listings" />
      <div className="p-6 space-y-6">
        <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as TabValue)}>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="ads">Promoted Ads</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
          </TabsList>

          <TabsContent value="ads" className="mt-6">
            <PromotedAdsView />
          </TabsContent>

          <TabsContent value="schedule" className="mt-6">
            <ScheduleConfigView />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
