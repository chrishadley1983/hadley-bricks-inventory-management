'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import type { NegotiationOffer } from '@/lib/ebay/negotiation.types';

interface RecentOffersTableProps {
  offers?: NegotiationOffer[];
  isLoading?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
}

/**
 * Get status badge color
 */
function getStatusBadgeVariant(status: NegotiationOffer['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'ACCEPTED':
      return 'default'; // Green-ish
    case 'PENDING':
      return 'secondary';
    case 'DECLINED':
      return 'destructive';
    case 'EXPIRED':
    case 'FAILED':
      return 'outline';
    default:
      return 'secondary';
  }
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-16" />
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-24" />
        </div>
      ))}
    </div>
  );
}

export function RecentOffersTable({
  offers,
  isLoading,
  total,
  page = 0,
  pageSize = 10,
  onPageChange,
}: RecentOffersTableProps) {
  const totalPages = total ? Math.ceil(total / pageSize) : 0;
  const startIndex = page * pageSize + 1;
  const endIndex = Math.min((page + 1) * pageSize, total ?? 0);

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="recent-offers-table">
        <h3 className="text-lg font-semibold">Recent Offers</h3>
        <TableSkeleton />
      </div>
    );
  }

  if (!offers || offers.length === 0) {
    return (
      <div className="space-y-4" data-testid="recent-offers-table">
        <h3 className="text-lg font-semibold">Recent Offers</h3>
        <div className="text-center py-8 text-muted-foreground">
          No offers sent yet. Click &quot;Send Offers Now&quot; to get started.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="recent-offers-table">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Recent Offers</h3>
        {total !== undefined && (
          <span className="text-sm text-muted-foreground">
            Showing {startIndex}-{endIndex} of {total}
          </span>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Listing</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead className="text-right">Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {offers.map((offer) => (
              <TableRow key={offer.id}>
                <TableCell className="font-medium max-w-[250px]">
                  <div className="flex items-center gap-2">
                    {offer.isReOffer && (
                      <span title="Re-offer">
                        <RefreshCw className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      </span>
                    )}
                    <a
                      href={`https://www.ebay.co.uk/itm/${offer.ebayListingId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col hover:underline min-w-0"
                    >
                      {offer.listingTitle ? (
                        <>
                          <span className="truncate" title={offer.listingTitle}>
                            {offer.listingTitle}
                          </span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            {offer.ebayListingId}
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          </span>
                        </>
                      ) : (
                        <span className="flex items-center gap-1">
                          {offer.ebayListingId}
                          <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        </span>
                      )}
                    </a>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {offer.discountPercentage}%
                </TableCell>
                <TableCell className="max-w-[300px]">
                  <span className="text-sm text-muted-foreground line-clamp-2" title={offer.offerMessage}>
                    {offer.offerMessage || '-'}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={getStatusBadgeVariant(offer.status)}>
                    {offer.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(offer.sentAt)}
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-sm text-muted-foreground">{offer.score}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && onPageChange && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages - 1}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
