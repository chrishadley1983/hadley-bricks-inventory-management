'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { HeaderSkeleton, TableSkeleton } from '@/components/ui/skeletons';

const Header = dynamic(
  () => import('@/components/layout/Header').then((m) => ({ default: m.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

const ListingAssistantTabs = dynamic(
  () =>
    import('@/components/features/listing-assistant').then((m) => ({
      default: m.ListingAssistantTabs,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4">
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 w-32 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
        <TableSkeleton columns={4} rows={5} />
      </div>
    ),
  }
);

export default function ListingAssistantPage() {
  return (
    <>
      <Header
        title="Listing Assistant"
        description="Create AI-powered eBay listings with price research and image optimization"
      />
      <div className="p-6">
        <Suspense
          fallback={
            <div className="space-y-4">
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-10 w-32 animate-pulse rounded-md bg-muted" />
                ))}
              </div>
              <TableSkeleton columns={4} rows={5} />
            </div>
          }
        >
          <ListingAssistantTabs />
        </Suspense>
      </div>
    </>
  );
}
