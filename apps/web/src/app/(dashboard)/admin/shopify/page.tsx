'use client';

import dynamic from 'next/dynamic';
import { useShopifySyncStatus } from '@/hooks/use-shopify-sync';
import { StatCardSkeleton } from '@/components/ui/skeletons';

const Header = dynamic(
  () =>
    import('@/components/layout/Header').then((mod) => ({
      default: mod.Header,
    })),
  { ssr: false }
);

const ShopifySyncSummary = dynamic(
  () =>
    import('@/components/features/shopify-sync').then((mod) => ({
      default: mod.ShopifySyncSummary,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    ),
  }
);

const ShopifySyncControls = dynamic(
  () =>
    import('@/components/features/shopify-sync').then((mod) => ({
      default: mod.ShopifySyncControls,
    })),
  {
    ssr: false,
    loading: () => <StatCardSkeleton />,
  }
);

const ShopifyConfigCard = dynamic(
  () =>
    import('@/components/features/shopify-sync').then((mod) => ({
      default: mod.ShopifyConfigCard,
    })),
  {
    ssr: false,
    loading: () => <StatCardSkeleton />,
  }
);

export default function ShopifySyncPage() {
  const { data: status, isLoading } = useShopifySyncStatus();

  return (
    <>
      <Header title="Shopify Sync" />
      <div className="p-6 space-y-6">
        {status && <ShopifySyncSummary status={status} />}
        {isLoading && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <ShopifySyncControls />
          <ShopifyConfigCard />
        </div>
      </div>
    </>
  );
}
