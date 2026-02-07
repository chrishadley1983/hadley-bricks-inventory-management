'use client';

import { use } from 'react';
import dynamic from 'next/dynamic';
import { HeaderSkeleton } from '@/components/ui/skeletons';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

const InvestmentDetail = dynamic(
  () =>
    import('@/components/features/investment/InvestmentDetail').then((mod) => ({
      default: mod.InvestmentDetail,
    })),
  { ssr: false }
);

interface PageProps {
  params: Promise<{ setNumber: string }>;
}

export default function InvestmentSetDetailPage({ params }: PageProps) {
  const { setNumber } = use(params);

  return (
    <>
      <Header title="Set Detail" />
      <div className="p-6">
        <InvestmentDetail setNumber={decodeURIComponent(setNumber)} />
      </div>
    </>
  );
}
