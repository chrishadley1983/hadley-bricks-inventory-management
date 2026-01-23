'use client';

import dynamic from 'next/dynamic';
import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { usePurchase } from '@/hooks';
import { Button } from '@/components/ui/button';
import { usePerfPage } from '@/hooks/use-perf';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

const PurchaseForm = dynamic(
  () =>
    import('@/components/features/purchases/PurchaseForm').then((mod) => ({
      default: mod.PurchaseForm,
    })),
  { ssr: false }
);

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EditPurchasePage({ params }: PageProps) {
  usePerfPage('EditPurchasePage');
  const { id } = use(params);
  const { data: purchase, isLoading, error } = usePurchase(id);

  return (
    <>
      <Header title="Edit Purchase" />
      <div className="p-6">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/purchases/${id}`}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to Purchase
            </Link>
          </Button>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">Edit Purchase</h2>
          <p className="text-muted-foreground">Update the purchase details</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-pulse text-muted-foreground">Loading...</div>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
            <p>Failed to load purchase: {error.message}</p>
          </div>
        ) : purchase ? (
          <div className="max-w-2xl">
            <PurchaseForm mode="edit" initialData={purchase} />
          </div>
        ) : null}
      </div>
    </>
  );
}
