'use client';

import dynamic from 'next/dynamic';
import { use } from 'react';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

const BrickLinkUploadDetail = dynamic(
  () =>
    import('@/components/features/bricklink-uploads/BrickLinkUploadDetail').then((mod) => ({
      default: mod.BrickLinkUploadDetail,
    })),
  { ssr: false }
);

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function BrickLinkUploadDetailPage({ params }: PageProps) {
  const { id } = use(params);

  return (
    <>
      <Header title="Upload Details" />
      <div className="p-6">
        <BrickLinkUploadDetail id={id} />
      </div>
    </>
  );
}
