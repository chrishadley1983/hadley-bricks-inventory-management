'use client';

import dynamic from 'next/dynamic';
import { use } from 'react';
import { usePerfPage } from '@/hooks/use-perf';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

const PurchaseDetail = dynamic(
  () =>
    import('@/components/features/purchases/PurchaseDetail').then((mod) => ({
      default: mod.PurchaseDetail,
    })),
  { ssr: false }
);

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function PurchaseDetailPage({ params }: PageProps) {
  usePerfPage('PurchaseDetailPage');
  const { id } = use(params);

  return (
    <>
      <Header title="Purchase Details" />
      <div className="p-6">
        <PurchaseDetail id={id} />
      </div>
    </>
  );
}
