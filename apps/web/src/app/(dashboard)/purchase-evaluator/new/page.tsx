'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HeaderSkeleton } from '@/components/ui/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

const PurchaseEvaluatorWizard = dynamic(
  () =>
    import('@/components/features/purchase-evaluator').then((mod) => ({
      default: mod.PurchaseEvaluatorWizard,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    ),
  }
);

export default function NewPurchaseEvaluatorPage() {
  return (
    <>
      <Header title="New Evaluation" />
      <div className="p-6">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/purchase-evaluator">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to Evaluations
            </Link>
          </Button>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">New Purchase Evaluation</h2>
          <p className="text-muted-foreground">
            Import items and analyze pricing across Amazon and eBay
          </p>
        </div>

        <PurchaseEvaluatorWizard />
      </div>
    </>
  );
}
