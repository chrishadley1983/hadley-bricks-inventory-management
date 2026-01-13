'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Trash2, ShoppingCart, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HeaderSkeleton, TableSkeleton } from '@/components/ui/skeletons';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useEvaluation, useDeleteEvaluation } from '@/hooks/use-purchase-evaluator';
import { formatCurrency } from '@/lib/utils';
import { format } from 'date-fns';
import type { EvaluationItem } from '@/lib/purchase-evaluator';
import { ConvertToPurchaseDialog } from '@/components/features/purchase-evaluator';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

function SummaryCard({
  title,
  value,
  subValue,
}: {
  title: string;
  value: string;
  subValue?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
      </CardContent>
    </Card>
  );
}

function getPlatformBadge(platform: string | null) {
  if (!platform) return null;
  return (
    <Badge variant={platform === 'amazon' ? 'default' : 'secondary'}>
      {platform === 'amazon' ? 'Amazon' : 'eBay'}
    </Badge>
  );
}

function getStatusBadge(item: EvaluationItem) {
  // If user has set a manual price override, show as "Manual"
  if (item.userSellPriceOverride && item.userSellPriceOverride > 0) {
    return (
      <Badge variant="outline" className="border-blue-500 text-blue-500">
        Manual
      </Badge>
    );
  }
  if (item.needsReview) {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-500">
        Review
      </Badge>
    );
  }
  // Check platform-specific lookup status
  const lookupStatus = item.targetPlatform === 'ebay'
    ? item.ebayLookupStatus
    : item.amazonLookupStatus;

  if (lookupStatus === 'found') {
    return (
      <Badge variant="outline" className="border-green-500 text-green-500">
        Found
      </Badge>
    );
  }
  if (lookupStatus === 'not_found' || lookupStatus === 'error') {
    return (
      <Badge variant="outline" className="border-red-500 text-red-500">
        Not Found
      </Badge>
    );
  }
  return <Badge variant="outline">Pending</Badge>;
}

export default function EvaluationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);

  const { data: evaluation, isLoading, error } = useEvaluation(id);
  const deleteMutation = useDeleteEvaluation();

  // Check if evaluation can be converted
  const canConvert =
    evaluation?.status === 'completed' || evaluation?.status === 'saved';
  const isConverted = evaluation?.status === 'converted';
  const isConvertible = canConvert && !isConverted;

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(id);
    router.push('/purchase-evaluator');
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

  const items = evaluation.items || [];

  // Calculate total expected profit from items
  const totalExpectedProfit = items.reduce((sum, item) => sum + (item.grossProfit || 0), 0);

  return (
    <>
      <Header
        title={evaluation.name || `Evaluation ${format(new Date(evaluation.createdAt), 'MMM d')}`}
      />
      <div className="p-6">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/purchase-evaluator">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to Evaluations
              </Link>
            </Button>
            <h2 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight">
              {evaluation.name || `Evaluation ${format(new Date(evaluation.createdAt), 'MMM d')}`}
              {isConverted && (
                <Badge variant="default" className="bg-green-600">
                  <CheckCircle className="mr-1 h-3 w-3" />
                  Converted
                </Badge>
              )}
            </h2>
            <p className="text-muted-foreground">
              Created {format(new Date(evaluation.createdAt), 'MMMM d, yyyy')}
              {isConverted && evaluation.convertedPurchaseId && (
                <>
                  {' '}
                  &middot;{' '}
                  <Link
                    href={`/purchases/${evaluation.convertedPurchaseId}`}
                    className="text-primary hover:underline"
                  >
                    View Purchase
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/purchase-evaluator/${id}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
            {isConvertible && (
              <Button size="sm" onClick={() => setShowConvertDialog(true)}>
                <ShoppingCart className="mr-2 h-4 w-4" />
                Convert to Purchase
              </Button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <SummaryCard
            title="Total Cost"
            value={
              evaluation.totalCost != null ? formatCurrency(evaluation.totalCost, 'GBP') : '-'
            }
            subValue={`${evaluation.itemCount} items`}
          />
          <SummaryCard
            title="Expected Revenue"
            value={
              evaluation.totalExpectedRevenue != null
                ? formatCurrency(evaluation.totalExpectedRevenue, 'GBP')
                : '-'
            }
          />
          <SummaryCard
            title="Expected Profit"
            value={totalExpectedProfit > 0 ? formatCurrency(totalExpectedProfit, 'GBP') : '-'}
            subValue={
              evaluation.overallMarginPercent != null
                ? `${evaluation.overallMarginPercent.toFixed(1)}% margin`
                : undefined
            }
          />
          <SummaryCard
            title="ROI"
            value={
              evaluation.overallRoiPercent != null
                ? `${evaluation.overallRoiPercent.toFixed(1)}%`
                : '-'
            }
          />
        </div>

        {/* Items Table */}
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Set Number</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead className="text-right">Sell Price</TableHead>
                <TableHead className="text-right">COG%</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                // Get sell price: user override > platform price > was price
                let sellPrice: number | null = null;
                if (item.userSellPriceOverride && item.userSellPriceOverride > 0) {
                  sellPrice = item.userSellPriceOverride;
                } else if (item.targetPlatform === 'ebay') {
                  sellPrice = item.ebaySoldAvgPrice || item.ebayAvgPrice || null;
                } else {
                  // Amazon - Buy Box, then Was Price
                  sellPrice = item.amazonBuyBoxPrice || item.amazonWasPrice || null;
                }

                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.setNumber}</TableCell>
                    <TableCell>{item.condition}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">
                      {item.allocatedCost != null
                        ? formatCurrency(item.allocatedCost, 'GBP')
                        : '-'}
                    </TableCell>
                    <TableCell>{getPlatformBadge(item.targetPlatform)}</TableCell>
                    <TableCell className="text-right">
                      {sellPrice != null ? formatCurrency(sellPrice, 'GBP') : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.cogPercent != null ? (
                        <span
                          className={
                            item.cogPercent < 50
                              ? 'text-green-600'
                              : item.cogPercent < 70
                                ? 'text-amber-600'
                                : 'text-red-600'
                          }
                        >
                          {item.cogPercent.toFixed(0)}%
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(item)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Evaluation?</DialogTitle>
            <DialogDescription>
              This will permanently delete this evaluation and all its items. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
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

      {/* Convert to Purchase Dialog */}
      {evaluation && (
        <ConvertToPurchaseDialog
          open={showConvertDialog}
          onOpenChange={setShowConvertDialog}
          evaluation={evaluation}
        />
      )}
    </>
  );
}
