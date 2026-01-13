'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HeaderSkeleton, TableSkeleton } from '@/components/ui/skeletons';
import { Card, CardContent } from '@/components/ui/card';
import { useEvaluation } from '@/hooks/use-purchase-evaluator';
import { ReviewStep } from '@/components/features/purchase-evaluator/steps/ReviewStep';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

export default function EditEvaluationPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: evaluation, isLoading, error, refetch } = useEvaluation(id);

  // Handle updating items
  const handleUpdateItems = async (updates: Array<{
    id: string;
    allocatedCost?: number | null;
    amazonAsin?: string;
    targetPlatform?: 'amazon' | 'ebay';
    userSellPriceOverride?: number | null;
  }>) => {
    try {
      const response = await fetch(`/api/purchase-evaluator/${id}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updates }),
      });

      if (response.ok) {
        await refetch();
      }
    } catch (error) {
      console.error('Failed to update items:', error);
    }
  };

  // Handle recalculating costs
  const handleRecalculateCosts = async () => {
    try {
      const response = await fetch(`/api/purchase-evaluator/${id}/recalculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        await refetch();
      }
    } catch (error) {
      console.error('Failed to recalculate costs:', error);
    }
  };

  // Handle save - just navigate back to detail page
  const handleSave = async () => {
    router.push(`/purchase-evaluator/${id}`);
  };

  // Handle back - navigate to detail page
  const handleBack = () => {
    router.push(`/purchase-evaluator/${id}`);
  };

  if (isLoading) {
    return (
      <>
        <Header title="Loading..." />
        <div className="p-6">
          <TableSkeleton columns={8} rows={10} />
        </div>
      </>
    );
  }

  if (error || !evaluation) {
    return (
      <>
        <Header title="Error" />
        <div className="p-6">
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-destructive">{error?.message || 'Evaluation not found'}</p>
              <Button variant="outline" className="mt-4" asChild>
                <Link href="/purchase-evaluator">Back to Evaluations</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={`Edit: ${evaluation.name || 'Evaluation'}`} />
      <div className="p-6">
        <div className="mb-6">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Evaluation
          </Button>
        </div>

        <ReviewStep
          evaluation={evaluation}
          onSave={handleSave}
          onBack={handleBack}
          onUpdateItems={handleUpdateItems}
          onRecalculateCosts={handleRecalculateCosts}
        />
      </div>
    </>
  );
}
