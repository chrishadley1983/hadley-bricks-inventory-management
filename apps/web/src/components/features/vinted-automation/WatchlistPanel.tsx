/**
 * Watchlist Panel
 *
 * Shows the 200 tracked sets with their scan effectiveness stats
 */

'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useWatchlist,
  useRefreshWatchlist,
  type WatchlistItem,
} from '@/hooks/use-vinted-automation';
import { Target, RefreshCw, AlertCircle, TrendingUp, Crown, Archive, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useDebouncedCallback } from 'use-debounce';

function getSourceBadge(source: WatchlistItem['source']) {
  if (source === 'best_seller') {
    return (
      <Badge className="bg-yellow-500">
        <Crown className="mr-1 h-3 w-3" />
        Best Seller
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <Archive className="mr-1 h-3 w-3" />
      Retired
    </Badge>
  );
}

export function WatchlistPanel() {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const { data, isLoading, error } = useWatchlist();
  const refreshWatchlist = useRefreshWatchlist();

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setSearch(value);
  }, 300);

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-red-600">
            <AlertCircle className="h-5 w-5" />
            <span>Failed to load watchlist</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const items = data?.items ?? [];

  // Filter items
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      !search ||
      item.set_number.toLowerCase().includes(search.toLowerCase()) ||
      item.asin?.toLowerCase().includes(search.toLowerCase());

    const matchesSource = sourceFilter === 'all' || item.source === sourceFilter;

    return matchesSearch && matchesSource;
  });

  // Sort by viable_found (effectiveness) then by last_viable_at
  const sortedItems = [...filteredItems].sort((a, b) => {
    const aViable = a.stats?.viable_found ?? 0;
    const bViable = b.stats?.viable_found ?? 0;
    if (bViable !== aViable) return bViable - aViable;

    const aLastViable = a.stats?.last_viable_at ? new Date(a.stats.last_viable_at).getTime() : 0;
    const bLastViable = b.stats?.last_viable_at ? new Date(b.stats.last_viable_at).getTime() : 0;
    return bLastViable - aLastViable;
  });

  // Calculate stats
  const bestSellerCount = items.filter((i) => i.source === 'best_seller').length;
  const retiredCount = items.filter((i) => i.source === 'popular_retired').length;
  const totalViable = items.reduce((sum, i) => sum + (i.stats?.viable_found ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Watchlist
              <Badge variant="secondary" className="ml-2">
                {items.length} sets
              </Badge>
            </CardTitle>
            <CardDescription>
              {bestSellerCount} best sellers • {retiredCount} popular retired • {totalViable} total
              opportunities found
            </CardDescription>
          </div>

          <Button
            onClick={() => refreshWatchlist.mutate()}
            disabled={refreshWatchlist.isPending}
            variant="outline"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${refreshWatchlist.isPending ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search set number or ASIN..."
              onChange={(e) => debouncedSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="best_seller">Best Sellers</SelectItem>
              <SelectItem value="popular_retired">Retired</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <WatchlistTableSkeleton />
        ) : sortedItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {items.length === 0 ? (
              <div>
                <p>Watchlist is empty</p>
                <p className="text-sm">Click Refresh to populate from Amazon best sellers</p>
              </div>
            ) : (
              <p>No sets match your filters</p>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Set</TableHead>
                <TableHead>ASIN</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Sales Rank</TableHead>
                <TableHead className="text-right">Scans</TableHead>
                <TableHead className="text-right">Listings</TableHead>
                <TableHead className="text-right">Viable</TableHead>
                <TableHead>Last Viable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono font-medium">{item.set_number}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {item.asin || '-'}
                  </TableCell>
                  <TableCell>{getSourceBadge(item.source)}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {item.sales_rank?.toLocaleString() || '-'}
                  </TableCell>
                  <TableCell className="text-right">{item.stats?.total_scans ?? 0}</TableCell>
                  <TableCell className="text-right">{item.stats?.listings_found ?? 0}</TableCell>
                  <TableCell className="text-right">
                    {(item.stats?.viable_found ?? 0) > 0 ? (
                      <span className="font-medium text-green-600 flex items-center justify-end gap-1">
                        <TrendingUp className="h-3 w-3" />
                        {item.stats?.viable_found}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.stats?.last_viable_at
                      ? formatDistanceToNow(new Date(item.stats.last_viable_at), {
                          addSuffix: true,
                        })
                      : 'Never'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function WatchlistTableSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(10)].map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
