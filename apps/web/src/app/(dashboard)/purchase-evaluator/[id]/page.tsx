'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Trash2, ShoppingCart, CheckCircle, Calculator } from 'lucide-react';
import { usePerfPage } from '@/hooks/use-perf';
import { Button } from '@/components/ui/button';
import { HeaderSkeleton, TableSkeleton } from '@/components/ui/skeletons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useEvaluation, useDeleteEvaluation, useUpdateEvaluation } from '@/hooks/use-purchase-evaluator';
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
  usePerfPage('EvaluationDetailPage');
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [actualCostInput, setActualCostInput] = useState<string>('');
  const [isSavingActualCost, setIsSavingActualCost] = useState(false);

  const { data: evaluation, isLoading, error, refetch } = useEvaluation(id);
  const deleteMutation = useDeleteEvaluation();
  const updateMutation = useUpdateEvaluation();

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
            title={evaluation.evaluationMode === 'max_bid' ? 'Max Purchase Price' : 'Total Cost'}
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

        {/* Actual Purchase Cost Card - Only for max_bid evaluations */}
        {evaluation.evaluationMode === 'max_bid' && (
          <Card className="mb-6 border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Calculator className="h-5 w-5" />
                Calculate Actual Profit
              </CardTitle>
              <CardDescription>
                Enter what you actually paid to see your real profit vs the calculated max bid of{' '}
                {evaluation.totalCost != null ? formatCurrency(evaluation.totalCost, 'GBP') : '-'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="actualCost">Actual Purchase Cost</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        £
                      </span>
                      <Input
                        id="actualCost"
                        type="number"
                        step="0.01"
                        min="0"
                        className="pl-7"
                        placeholder="0.00"
                        value={actualCostInput}
                        onChange={(e) => setActualCostInput(e.target.value)}
                      />
                    </div>
                    <Button
                      onClick={async () => {
                        const actualCost = parseFloat(actualCostInput);
                        if (isNaN(actualCost) || actualCost < 0) return;
                        setIsSavingActualCost(true);
                        try {
                          // Update the evaluation with the actual cost
                          await updateMutation.mutateAsync({
                            id,
                            totalPurchasePrice: actualCost,
                            costAllocationMethod: 'proportional', // Distribute proportionally
                          });
                          // Recalculate costs and profitability
                          const recalcResponse = await fetch(`/api/purchase-evaluator/${id}/recalculate`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                          });
                          if (!recalcResponse.ok) {
                            throw new Error('Failed to recalculate profitability');
                          }
                          await refetch();
                        } catch (error) {
                          console.error('Failed to calculate profit:', error);
                          alert('Failed to calculate profit. Please try again.');
                        } finally {
                          setIsSavingActualCost(false);
                        }
                      }}
                      disabled={!actualCostInput || isSavingActualCost}
                    >
                      {isSavingActualCost ? 'Calculating...' : 'Calculate Profit'}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Profit Comparison</Label>
                  <div className="grid grid-cols-2 gap-4 p-3 bg-background rounded-lg border">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">At Max Bid</p>
                      <p className="text-lg font-semibold text-muted-foreground">
                        {evaluation.targetMarginPercent ?? 30}% margin
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">At Actual Cost</p>
                      <p className={`text-lg font-semibold ${
                        evaluation.overallMarginPercent != null && evaluation.overallMarginPercent > 0
                          ? 'text-green-600'
                          : 'text-muted-foreground'
                      }`}>
                        {evaluation.overallMarginPercent != null
                          ? `${evaluation.overallMarginPercent.toFixed(1)}% margin`
                          : 'Enter cost'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Items Table */}
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <TooltipProvider>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Set Number</TableHead>
                  <TableHead>Name</TableHead>
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
                  let priceSource: 'override' | 'buybox' | 'was' | 'ebay_sold' | 'ebay_active' | null = null;
                  if (item.userSellPriceOverride && item.userSellPriceOverride > 0) {
                    sellPrice = item.userSellPriceOverride;
                    priceSource = 'override';
                  } else if (item.targetPlatform === 'ebay') {
                    if (item.ebaySoldAvgPrice) {
                      sellPrice = item.ebaySoldAvgPrice;
                      priceSource = 'ebay_sold';
                    } else if (item.ebayAvgPrice) {
                      sellPrice = item.ebayAvgPrice;
                      priceSource = 'ebay_active';
                    }
                  } else {
                    // Amazon - Buy Box, then Was Price
                    if (item.amazonBuyBoxPrice) {
                      sellPrice = item.amazonBuyBoxPrice;
                      priceSource = 'buybox';
                    } else if (item.amazonWasPrice) {
                      sellPrice = item.amazonWasPrice;
                      priceSource = 'was';
                    }
                  }

                  // Check if we have Amazon data to show tooltip
                  const hasAmazonData = item.targetPlatform === 'amazon' &&
                    (item.amazonBuyBoxPrice || item.amazonSalesRank || item.amazonOfferCount !== null);

                  // Check if we have eBay data to show tooltip
                  const hasEbayData = item.targetPlatform === 'ebay' &&
                    (item.ebaySoldAvgPrice || item.ebayAvgPrice || item.ebaySoldCount);

                  // Get velocity indicator for Amazon
                  const getVelocityIndicator = (salesRank: number | null) => {
                    if (!salesRank) return null;
                    if (salesRank < 10000) return { label: 'Fast', color: 'text-green-600' };
                    if (salesRank < 50000) return { label: 'Medium', color: 'text-amber-600' };
                    if (salesRank < 100000) return { label: 'Slow', color: 'text-orange-600' };
                    return { label: 'Very Slow', color: 'text-red-600' };
                  };

                  const velocity = getVelocityIndicator(item.amazonSalesRank);

                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.setNumber}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={item.setName || undefined}>
                        {item.setName || '-'}
                      </TableCell>
                      <TableCell>{item.condition}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">
                        {item.allocatedCost != null
                          ? formatCurrency(item.allocatedCost, 'GBP')
                          : '-'}
                      </TableCell>
                      <TableCell>{getPlatformBadge(item.targetPlatform)}</TableCell>
                      <TableCell className="text-right">
                        {sellPrice != null ? (
                          hasAmazonData || hasEbayData ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help underline decoration-dotted underline-offset-4">
                                  {formatCurrency(sellPrice, 'GBP')}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="space-y-1 text-xs">
                                  {item.targetPlatform === 'amazon' ? (
                                    <>
                                      <p className="font-semibold">Amazon Listing Details</p>
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                        {item.amazonBuyBoxPrice && (
                                          <>
                                            <span className="text-muted-foreground">Buy Box:</span>
                                            <span>{formatCurrency(item.amazonBuyBoxPrice, 'GBP')}</span>
                                          </>
                                        )}
                                        {item.amazonWasPrice && (
                                          <>
                                            <span className="text-muted-foreground">Was Price:</span>
                                            <span>{formatCurrency(item.amazonWasPrice, 'GBP')}</span>
                                          </>
                                        )}
                                        {item.amazonSalesRank && (
                                          <>
                                            <span className="text-muted-foreground">Sales Rank:</span>
                                            <span>#{item.amazonSalesRank.toLocaleString()}</span>
                                          </>
                                        )}
                                        {item.amazonOfferCount !== null && (
                                          <>
                                            <span className="text-muted-foreground">Sellers:</span>
                                            <span>{item.amazonOfferCount} offer{item.amazonOfferCount !== 1 ? 's' : ''}</span>
                                          </>
                                        )}
                                        {velocity && (
                                          <>
                                            <span className="text-muted-foreground">Velocity:</span>
                                            <span className={velocity.color}>{velocity.label}</span>
                                          </>
                                        )}
                                      </div>
                                      {priceSource === 'override' && (
                                        <p className="mt-1 text-blue-500">Using manual price override</p>
                                      )}
                                      {priceSource === 'was' && (
                                        <p className="mt-1 text-amber-500">No Buy Box - using Was Price</p>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <p className="font-semibold">eBay Listing Details</p>
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                        {item.ebaySoldAvgPrice && (
                                          <>
                                            <span className="text-muted-foreground">Sold Avg:</span>
                                            <span>{formatCurrency(item.ebaySoldAvgPrice, 'GBP')}</span>
                                          </>
                                        )}
                                        {item.ebaySoldCount && (
                                          <>
                                            <span className="text-muted-foreground">Sold (30d):</span>
                                            <span>{item.ebaySoldCount} item{item.ebaySoldCount !== 1 ? 's' : ''}</span>
                                          </>
                                        )}
                                        {item.ebayAvgPrice && (
                                          <>
                                            <span className="text-muted-foreground">Active Avg:</span>
                                            <span>{formatCurrency(item.ebayAvgPrice, 'GBP')}</span>
                                          </>
                                        )}
                                        {item.ebayListingCount && (
                                          <>
                                            <span className="text-muted-foreground">Active:</span>
                                            <span>{item.ebayListingCount} listing{item.ebayListingCount !== 1 ? 's' : ''}</span>
                                          </>
                                        )}
                                      </div>
                                      {priceSource === 'override' && (
                                        <p className="mt-1 text-blue-500">Using manual price override</p>
                                      )}
                                    </>
                                  )}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            formatCurrency(sellPrice, 'GBP')
                          )
                        ) : (
                          '-'
                        )}
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
          </TooltipProvider>
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
