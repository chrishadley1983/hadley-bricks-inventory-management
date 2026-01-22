/**
 * Scan Detail Dialog
 *
 * Shows detailed results of a scan including all processed listings
 */

'use client';

import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { type ScanLogEntry } from '@/hooks/use-vinted-automation';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Package,
  Timer,
  Search,
  Target,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { format } from 'date-fns';

type SortField = 'setNumber' | 'vintedPrice' | 'amazonPrice' | 'cogPercent' | 'profit';
type SortDirection = 'asc' | 'desc';

interface ProcessedListing {
  setNumber: string;
  title: string;
  vintedPrice: number;
  vintedUrl: string;
  amazonPrice: number | null;
  asin: string | null;
  setName: string | null;
  totalCost: number;
  cogPercent: number | null;
  profit: number | null;
  roi: number | null;
  isViable: boolean;
  isNearMiss: boolean;
}

interface ScanResults {
  processedListings: ProcessedListing[];
  summary: {
    totalListings: number;
    viableCount: number;
    nearMissCount: number;
    setsIdentified: number;
    cogThreshold: number;
    nearMissThreshold: number;
  };
}

interface ScanDetailDialogProps {
  scan: ScanLogEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getStatusBadge(status: ScanLogEntry['status']) {
  switch (status) {
    case 'success':
      return (
        <Badge className="bg-green-600">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Success
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" />
          Failed
        </Badge>
      );
    case 'partial':
      return (
        <Badge className="bg-yellow-500">
          <AlertTriangle className="mr-1 h-3 w-3" />
          Partial
        </Badge>
      );
    case 'captcha':
      return (
        <Badge className="bg-orange-500">
          <ShieldAlert className="mr-1 h-3 w-3" />
          CAPTCHA
        </Badge>
      );
  }
}

function getCogBadge(cogPercent: number | null, isViable: boolean, isNearMiss: boolean) {
  if (cogPercent === null) {
    return <span className="text-muted-foreground">-</span>;
  }

  if (isViable) {
    return (
      <Badge className="bg-green-600">
        <TrendingUp className="mr-1 h-3 w-3" />
        {cogPercent.toFixed(0)}%
      </Badge>
    );
  }

  if (isNearMiss) {
    return (
      <Badge className="bg-yellow-500">
        <AlertTriangle className="mr-1 h-3 w-3" />
        {cogPercent.toFixed(0)}%
      </Badge>
    );
  }

  return (
    <Badge variant="secondary">
      <TrendingDown className="mr-1 h-3 w-3" />
      {cogPercent.toFixed(0)}%
    </Badge>
  );
}

function SortableHeader({
  field,
  currentSort,
  currentDirection,
  onSort,
  children,
  className,
}: {
  field: SortField;
  currentSort: SortField | null;
  currentDirection: SortDirection;
  onSort: (field: SortField) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const isActive = currentSort === field;

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-8 px-2 -ml-2 font-medium hover:bg-muted ${className ?? ''}`}
      onClick={() => onSort(field)}
    >
      {children}
      {isActive ? (
        currentDirection === 'asc' ? (
          <ArrowUp className="ml-1 h-3 w-3" />
        ) : (
          <ArrowDown className="ml-1 h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
      )}
    </Button>
  );
}

export function ScanDetailDialog({ scan, open, onOpenChange }: ScanDetailDialogProps) {
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const scanResults = scan?.scan_results as ScanResults | null;
  const summary = scanResults?.summary;

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Memoize listings with processedListings as direct dependency to avoid
  // creating a new rawListings array reference on every render
  const listings = useMemo(() => {
    const rawListings = scanResults?.processedListings ?? [];
    if (!sortField) return rawListings;

    return [...rawListings].sort((a, b) => {
      let aVal: number | string | null;
      let bVal: number | string | null;

      switch (sortField) {
        case 'setNumber':
          aVal = a.setNumber;
          bVal = b.setNumber;
          break;
        case 'vintedPrice':
          aVal = a.vintedPrice;
          bVal = b.vintedPrice;
          break;
        case 'amazonPrice':
          aVal = a.amazonPrice;
          bVal = b.amazonPrice;
          break;
        case 'cogPercent':
          aVal = a.cogPercent;
          bVal = b.cogPercent;
          break;
        case 'profit':
          aVal = a.profit;
          bVal = b.profit;
          break;
        default:
          return 0;
      }

      // Handle nulls - push them to the end
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      // Compare values
      let comparison = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else {
        comparison = (aVal as number) - (bVal as number);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [scanResults?.processedListings, sortField, sortDirection]);

  if (!scan) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {scan.scan_type === 'broad_sweep' ? (
              <Search className="h-5 w-5 text-blue-500" />
            ) : (
              <Target className="h-5 w-5 text-purple-500" />
            )}
            {scan.scan_type === 'broad_sweep' ? 'Broad Sweep' : 'Watchlist'} Scan
            {scan.set_number && (
              <span className="font-mono text-muted-foreground">#{scan.set_number}</span>
            )}
          </DialogTitle>
          <DialogDescription>
            {scan.completed_at && format(new Date(scan.completed_at), 'PPpp')}
          </DialogDescription>
        </DialogHeader>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Listings</span>
              </div>
              <p className="text-2xl font-bold">{scan.listings_found}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-600" />
                <span className="text-sm text-muted-foreground">Opportunities</span>
              </div>
              <p className="text-2xl font-bold text-green-600">{scan.opportunities_found}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <span className="text-sm text-muted-foreground">Near Miss</span>
              </div>
              <p className="text-2xl font-bold text-yellow-600">{summary?.nearMissCount ?? 0}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Duration</span>
              </div>
              <p className="text-2xl font-bold">
                {scan.timing_delay_ms ? `${(scan.timing_delay_ms / 1000).toFixed(1)}s` : '-'}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>Status: {getStatusBadge(scan.status)}</span>
          {summary && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <span>COG Threshold: {summary.cogThreshold}%</span>
              <Separator orientation="vertical" className="h-4" />
              <span>Near Miss: {summary.nearMissThreshold}%</span>
            </>
          )}
        </div>

        {scan.error_message && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 text-red-700 text-sm">
            <strong>Error:</strong> {scan.error_message}
          </div>
        )}

        <Separator />

        {/* Listings Table */}
        {listings.length > 0 ? (
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <SortableHeader
                      field="setNumber"
                      currentSort={sortField}
                      currentDirection={sortDirection}
                      onSort={handleSort}
                    >
                      Set
                    </SortableHeader>
                  </TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right">
                    <SortableHeader
                      field="vintedPrice"
                      currentSort={sortField}
                      currentDirection={sortDirection}
                      onSort={handleSort}
                      className="justify-end"
                    >
                      Vinted
                    </SortableHeader>
                  </TableHead>
                  <TableHead className="text-right">
                    <SortableHeader
                      field="amazonPrice"
                      currentSort={sortField}
                      currentDirection={sortDirection}
                      onSort={handleSort}
                      className="justify-end"
                    >
                      Amazon
                    </SortableHeader>
                  </TableHead>
                  <TableHead className="text-right">
                    <SortableHeader
                      field="cogPercent"
                      currentSort={sortField}
                      currentDirection={sortDirection}
                      onSort={handleSort}
                      className="justify-end"
                    >
                      COG%
                    </SortableHeader>
                  </TableHead>
                  <TableHead className="text-right">
                    <SortableHeader
                      field="profit"
                      currentSort={sortField}
                      currentDirection={sortDirection}
                      onSort={handleSort}
                      className="justify-end"
                    >
                      Profit
                    </SortableHeader>
                  </TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listings.map((listing, idx) => (
                  <TableRow
                    key={idx}
                    className={
                      listing.isViable
                        ? 'bg-green-50 hover:bg-green-100'
                        : listing.isNearMiss
                          ? 'bg-yellow-50 hover:bg-yellow-100'
                          : ''
                    }
                  >
                    <TableCell className="font-mono text-sm">{listing.setNumber}</TableCell>
                    <TableCell>
                      <div className="max-w-[200px]">
                        <p className="truncate text-sm" title={listing.title}>
                          {listing.title}
                        </p>
                        {listing.setName && (
                          <p className="text-xs text-muted-foreground truncate">{listing.setName}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      £{listing.vintedPrice.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      {listing.amazonPrice ? (
                        `£${listing.amazonPrice.toFixed(2)}`
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {getCogBadge(listing.cogPercent, listing.isViable, listing.isNearMiss)}
                    </TableCell>
                    <TableCell className="text-right">
                      {listing.profit !== null ? (
                        <span
                          className={listing.profit > 0 ? 'text-green-600' : 'text-red-600'}
                        >
                          £{listing.profit.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {listing.amazonPrice && summary?.cogThreshold ? (
                        (() => {
                          // Calculate target Vinted price to hit COG threshold
                          // fees = totalCost - vintedPrice
                          // targetTotalCost = amazonPrice * threshold / 100
                          // targetVintedPrice = targetTotalCost - fees
                          const fees = listing.totalCost - listing.vintedPrice;
                          const targetTotalCost = listing.amazonPrice * (summary.cogThreshold / 100);
                          const targetPrice = targetTotalCost - fees;
                          const discount = listing.vintedPrice - targetPrice;

                          if (listing.isViable) {
                            return <span className="text-green-600">✓</span>;
                          }

                          return targetPrice > 0 ? (
                            <span className="text-blue-600" title={`Need £${discount.toFixed(2)} off`}>
                              £{targetPrice.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          );
                        })()
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <a
                        href={listing.vintedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            {scan.status === 'success' && scan.listings_found === 0
              ? 'No listings found for this scan'
              : 'No detailed results available for this scan'}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
