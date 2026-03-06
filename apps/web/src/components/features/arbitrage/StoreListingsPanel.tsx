'use client';

import { RefreshCw, Ban, Clock, ExternalLink } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useStoreListings,
  useScrapeStoreListings,
  useExcludeBrickLinkStore,
} from '@/hooks/use-arbitrage';
import { useToast } from '@/hooks/use-toast';
import { buildBricklinkUrl } from '@/lib/arbitrage/bricklink-url';
import { formatCurrency } from '@/lib/utils';
import { EXCLUSION_REASONS } from '@/lib/arbitrage/bricklink-store-constants';
import { cn } from '@/lib/utils';

interface StoreListingsPanelProps {
  setNumber: string | null;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function tierColor(tier: string): string {
  if (tier === 'uk') return 'text-green-600 dark:text-green-400';
  if (tier === 'eu') return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

export function StoreListingsPanel({ setNumber }: StoreListingsPanelProps) {
  const { data: listings, isLoading } = useStoreListings(setNumber);
  const scrapeMutation = useScrapeStoreListings();
  const excludeMutation = useExcludeBrickLinkStore();
  const { toast } = useToast();

  if (!setNumber) return null;

  const activeListings = (listings ?? []).filter((l) => !l.isExcluded);
  const excludedListings = (listings ?? []).filter((l) => l.isExcluded);
  const latestScrape = listings?.[0]?.scrapedAt;

  const handleScrape = async () => {
    try {
      await scrapeMutation.mutateAsync(setNumber);
      toast({ title: 'Store listings refreshed' });
    } catch (err) {
      toast({
        title: 'Scrape failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleExclude = async (storeName: string, reason: string) => {
    try {
      await excludeMutation.mutateAsync({ storeName, reason });
      toast({ title: `${storeName} excluded` });
    } catch {
      toast({ title: 'Failed to exclude store', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">Store Listings</h4>
          {latestScrape && (
            <Badge variant="outline" className="text-xs gap-1">
              <Clock className="h-3 w-3" />
              {formatTimeAgo(latestScrape)}
            </Badge>
          )}
          {!latestScrape && !isLoading && (
            <Badge variant="secondary" className="text-xs">
              No data
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a
              href={buildBricklinkUrl(setNumber)}
              target="_blank"
              rel="noopener noreferrer"
              className="gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              BrickLink
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleScrape}
            disabled={scrapeMutation.isPending}
          >
            <RefreshCw className={cn('h-3 w-3 mr-1', scrapeMutation.isPending && 'animate-spin')} />
            {scrapeMutation.isPending ? 'Scraping...' : 'Scrape Now'}
          </Button>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}

      {/* Active listings table */}
      {!isLoading && activeListings.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Store</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Min Buy</TableHead>
              <TableHead className="text-right">Est. Ship</TableHead>
              <TableHead className="text-right">Est. Total</TableHead>
              <TableHead className="text-right">Feedback</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeListings.map((listing) => (
              <TableRow key={listing.id}>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className={cn('font-medium text-sm', tierColor(listing.shippingTier))}>
                      {listing.storeName}
                    </span>
                    {listing.storeCountry && (
                      <span className="text-xs text-muted-foreground">
                        ({listing.storeCountry})
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatCurrency(listing.unitPrice, listing.currencyCode)}
                </TableCell>
                <TableCell className="text-right text-sm">{listing.quantity}</TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {listing.minBuy ? formatCurrency(listing.minBuy, listing.currencyCode) : '-'}
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  ~{formatCurrency(listing.estimatedShipping)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-medium">
                  ~{formatCurrency(listing.estimatedTotal, listing.currencyCode)}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {listing.storeFeedback ? `${listing.storeFeedback}%` : '-'}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        aria-label={`Exclude ${listing.storeName}`}
                      >
                        <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {EXCLUSION_REASONS.map((reason) => (
                        <DropdownMenuItem
                          key={reason.value}
                          onClick={() => handleExclude(listing.storeName, reason.value)}
                        >
                          {reason.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Empty state */}
      {!isLoading && !latestScrape && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Click &quot;Scrape Now&quot; to fetch store listings from BrickLink.
        </p>
      )}

      {!isLoading && latestScrape && activeListings.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No active store listings found. All may be excluded.
        </p>
      )}

      {/* Excluded listings (collapsed) */}
      {excludedListings.length > 0 && (
        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground mb-1">
            {excludedListings.length} excluded store{excludedListings.length !== 1 ? 's' : ''}{' '}
            hidden
          </p>
        </div>
      )}
    </div>
  );
}
