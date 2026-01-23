'use client';

import dynamic from 'next/dynamic';
import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useBrickLinkUpload } from '@/hooks/use-bricklink-uploads';
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

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EditBrickLinkUploadPage({ params }: PageProps) {
  usePerfPage('EditBrickLinkUploadPage');
  const { id } = use(params);
  const { data: upload, isLoading, error } = useBrickLinkUpload(id);

  return (
    <>
      <Header title="Edit Upload" />
      <div className="p-6">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/bricklink-uploads/${id}`}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to Upload
            </Link>
          </Button>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">Edit Upload</h2>
          <p className="text-muted-foreground">Update the upload details</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-pulse text-muted-foreground">Loading...</div>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
            <p>Failed to load upload: {error.message}</p>
          </div>
        ) : upload ? (
          <div className="max-w-2xl">
            <BrickLinkUploadForm mode="edit" initialData={upload} />
          </div>
        ) : null}
      </div>
    </>
  );
}
