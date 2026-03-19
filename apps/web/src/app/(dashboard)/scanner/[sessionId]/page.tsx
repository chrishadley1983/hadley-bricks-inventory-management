'use client';

import dynamic from 'next/dynamic';
import { use } from 'react';
import { usePerfPage } from '@/hooks';

// Dynamically import Header to prevent SSR issues with Supabase
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

// Dynamically import ScannerSessionDetail to prevent SSR issues
const ScannerSessionDetail = dynamic(
  () =>
    import('@/components/features/scanner').then((mod) => ({
      default: mod.ScannerSessionDetail,
    })),
  { ssr: false }
);

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default function ScannerSessionDetailPage({ params }: PageProps) {
  const { sessionId } = use(params);
  usePerfPage('ScannerSessionDetailPage');

  return (
    <>
      <Header title={`Session ${sessionId.slice(0, 8)}…`} />
      <div className="p-6">
        <ScannerSessionDetail sessionId={sessionId} />
      </div>
    </>
  );
}
