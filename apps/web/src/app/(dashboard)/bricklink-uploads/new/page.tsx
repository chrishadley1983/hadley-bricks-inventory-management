'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePerfPage } from '@/hooks/use-perf';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

const BrickLinkUploadForm = dynamic(
  () =>
    import('@/components/features/bricklink-uploads/BrickLinkUploadForm').then((mod) => ({
      default: mod.BrickLinkUploadForm,
    })),
  { ssr: false }
);

export default function NewBrickLinkUploadPage() {
  usePerfPage('NewBrickLinkUploadPage');
  return (
    <>
      <Header title="New Upload" />
      <div className="p-6">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/bricklink-uploads">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to Uploads
            </Link>
          </Button>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">New BrickLink Upload</h2>
          <p className="text-muted-foreground">Record a new inventory upload batch</p>
        </div>

        <div className="max-w-2xl">
          <BrickLinkUploadForm mode="create" />
        </div>
      </div>
    </>
  );
}
