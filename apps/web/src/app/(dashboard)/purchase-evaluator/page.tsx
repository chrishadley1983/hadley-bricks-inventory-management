'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Plus, FileSpreadsheet, Trash2, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HeaderSkeleton, TableSkeleton } from '@/components/ui/skeletons';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useEvaluations, useDeleteEvaluation } from '@/hooks/use-purchase-evaluator';
import { formatCurrency } from '@/lib/utils';
import { format } from 'date-fns';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

function getStatusBadge(status: string) {
  switch (status) {
    case 'draft':
      return <Badge variant="secondary">Draft</Badge>;
    case 'in_progress':
      return (
        <Badge variant="default" className="bg-blue-500">
          In Progress
        </Badge>
      );
    case 'completed':
      return (
        <Badge variant="default" className="bg-amber-500">
          Review
        </Badge>
      );
    case 'saved':
      return (
        <Badge variant="default" className="bg-green-500">
          Saved
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function EvaluationsList() {
  const { data: evaluations, isLoading, error } = useEvaluations();
  const deleteMutation = useDeleteEvaluation();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  if (isLoading) {
    return <TableSkeleton columns={6} rows={5} />;
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-destructive">Error loading evaluations: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  if (!evaluations || evaluations.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <FileSpreadsheet className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-medium">No evaluations yet</h3>
          <p className="mb-4 text-muted-foreground">
            Create a new evaluation to analyze potential purchases
          </p>
          <Button asChild>
            <Link href="/purchase-evaluator/new">
              <Plus className="mr-2 h-4 w-4" />
              New Evaluation
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const handleDelete = async () => {
    if (!deleteId) return;
    await deleteMutation.mutateAsync(deleteId);
    setDeleteId(null);
  };

  return (
    <>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Total Cost</TableHead>
              <TableHead className="text-right">Expected Revenue</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evaluations.map((evaluation) => (
              <TableRow key={evaluation.id}>
                <TableCell className="font-medium">
                  {evaluation.name ||
                    `Evaluation ${format(new Date(evaluation.createdAt), 'MMM d')}`}
                </TableCell>
                <TableCell>{getStatusBadge(evaluation.status)}</TableCell>
                <TableCell className="text-right">{evaluation.itemCount}</TableCell>
                <TableCell className="text-right">
                  {evaluation.totalCost != null ? formatCurrency(evaluation.totalCost, 'GBP') : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {evaluation.totalExpectedRevenue != null
                    ? formatCurrency(evaluation.totalExpectedRevenue, 'GBP')
                    : '-'}
                </TableCell>
                <TableCell>{format(new Date(evaluation.createdAt), 'MMM d, yyyy')}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/purchase-evaluator/${evaluation.id}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteId(evaluation.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!deleteId} onOpenChange={(open: boolean) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Evaluation?</DialogTitle>
            <DialogDescription>
              This will permanently delete this evaluation and all its items. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function PurchaseEvaluatorPage() {
  return (
    <>
      <Header title="Purchase Evaluator" />
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Purchase Evaluator</h2>
            <p className="text-muted-foreground">
              Analyze potential purchases with pricing lookups and profitability calculations
            </p>
          </div>
          <Button asChild>
            <Link href="/purchase-evaluator/new">
              <Plus className="mr-2 h-4 w-4" />
              New Evaluation
            </Link>
          </Button>
        </div>

        <EvaluationsList />
      </div>
    </>
  );
}
