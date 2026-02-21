'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  useMinifigRemovals,
  useApproveRemoval,
  useDismissRemoval,
  useBulkApproveRemovals,
} from '@/hooks/use-minifig-sync';
import { RemovalCard } from './RemovalCard';

export function RemovalQueue() {
  const { data: removals, isLoading } = useMinifigRemovals();
  const approveMutation = useApproveRemoval();
  const dismissMutation = useDismissRemoval();
  const bulkApproveMutation = useBulkApproveRemovals();

  const [activeId, setActiveId] = useState<string | null>(null);

  const handleApprove = async (removalId: string) => {
    setActiveId(removalId);
    try {
      await approveMutation.mutateAsync(removalId);
      toast.success('Removal approved and executed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve removal');
    } finally {
      setActiveId(null);
    }
  };

  const handleDismiss = async (removalId: string) => {
    setActiveId(removalId);
    try {
      await dismissMutation.mutateAsync(removalId);
      toast.success('Removal dismissed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to dismiss removal');
    } finally {
      setActiveId(null);
    }
  };

  const handleBulkApprove = async () => {
    try {
      const result = await bulkApproveMutation.mutateAsync();
      if (result.approved > 0) {
        toast.success(`Approved ${result.approved} removal${result.approved !== 1 ? 's' : ''}`);
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} removal${result.failed !== 1 ? 's' : ''} failed`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk approve failed');
    }
  };

  const pendingCount = removals?.length ?? 0;

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-56 rounded-lg border bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Pending Removals</h2>
          <Badge variant={pendingCount > 0 ? 'destructive' : 'secondary'}>{pendingCount}</Badge>
        </div>

        {/* Bulk Approve (F58) */}
        {pendingCount > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={bulkApproveMutation.isPending}>
                {bulkApproveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Approve All ({pendingCount})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Approve all {pendingCount} removals?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will execute all pending removals, deleting listings from the respective
                  platforms. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleBulkApprove}>Approve All</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Empty state */}
      {pendingCount === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h3 className="text-lg font-medium mb-1">No pending removals</h3>
          <p className="text-sm text-muted-foreground">
            Cross-platform sales will appear here for review
          </p>
        </div>
      )}

      {/* Cards grid */}
      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {(removals ?? []).map((removal) => (
          <RemovalCard
            key={removal.id}
            removal={removal}
            onApprove={handleApprove}
            onDismiss={handleDismiss}
            isApproving={approveMutation.isPending && activeId === removal.id}
            isDismissing={dismissMutation.isPending && activeId === removal.id}
          />
        ))}
      </div>
    </div>
  );
}
