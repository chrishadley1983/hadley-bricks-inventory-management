'use client';

import dynamic from 'next/dynamic';
import { use } from 'react';
import { usePerfPage } from '@/hooks';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

const SetCheckDetail = dynamic(
  () =>
    import('@/components/features/scanner').then((mod) => ({
      default: mod.SetCheckDetail,
    })),
  { ssr: false }
);

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default function SetCheckDetailPage({ params }: PageProps) {
  const { sessionId } = use(params);
  usePerfPage('SetCheckDetailPage');

  return (
    <>
      <Header title="Set Check Detail" />
      <div className="p-6">
        <SetCheckDetail sessionId={sessionId} />
      </div>
    </>
  );
}
