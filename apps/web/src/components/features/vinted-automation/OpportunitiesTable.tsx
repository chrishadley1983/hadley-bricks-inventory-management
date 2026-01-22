/**
 * Opportunities Table
 *
 * Shows found arbitrage opportunities with actions to mark as purchased/dismissed
 */

'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  useOpportunities,
  useUpdateOpportunityStatus,
  type Opportunity,
  type OpportunityFilters,
} from '@/hooks/use-vinted-automation';
import {
  ExternalLink,
  ShoppingCart,
  X,
  AlertCircle,
  TrendingUp,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

function getCogBadge(cogPercent: number | null) {
  if (cogPercent === null) return <Badge variant="outline">No data</Badge>;

  if (cogPercent < 30) {
    return <Badge className="bg-green-600">{cogPercent.toFixed(0)}% Excellent</Badge>;
  }
  if (cogPercent < 40) {
    return <Badge className="bg-green-500">{cogPercent.toFixed(0)}% Good</Badge>;
  }
  if (cogPercent < 50) {
    return <Badge className="bg-yellow-500">{cogPercent.toFixed(0)}% Marginal</Badge>;
  }
  return <Badge className="bg-red-500">{cogPercent.toFixed(0)}%</Badge>;
}

function formatCurrency(value: number | null): string {
  if (value === null) return '-';
  return `£${value.toFixed(2)}`;
}

function getStatusBadge(status: Opportunity['status']) {
  switch (status) {
    case 'active':
      return <Badge variant="default">Active</Badge>;
    case 'purchased':
      return <Badge className="bg-green-600">Purchased</Badge>;
    case 'expired':
      return <Badge variant="secondary">Expired</Badge>;
    case 'dismissed':
      return <Badge variant="outline">Dismissed</Badge>;
  }
}

export function OpportunitiesTable() {
  const [filters, setFilters] = useState<OpportunityFilters>({
    status: 'active',
    limit: 50,
  });

  const { data, isLoading, error } = useOpportunities(filters);
  const updateStatus = useUpdateOpportunityStatus();

  const handleStatusChange = (id: string, status: Opportunity['status']) => {
    updateStatus.mutate({ id, status });
  };

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-red-600">
            <AlertCircle className="h-5 w-5" />
            <span>Failed to load opportunities</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const opportunities = data?.opportunities ?? [];
  const activeCount = opportunities.filter((o) => o.status === 'active').length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
              Arbitrage Opportunities
              {activeCount > 0 && (
                <Badge className="ml-2 bg-green-600">{activeCount} active</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Found opportunities sorted by profit potential
            </CardDescription>
          </div>

          <Select
            value={filters.status || 'all'}
            onValueChange={(value: string) =>
              setFilters((f) => ({
                ...f,
                status: value === 'all' ? undefined : (value as OpportunityFilters['status']),
              }))
            }
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="purchased">Purchased</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <OpportunitiesTableSkeleton />
        ) : opportunities.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No opportunities found
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Set</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Vinted</TableHead>
                <TableHead className="text-right">Amazon</TableHead>
                <TableHead className="text-right">COG%</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Found</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opportunities.map((opp) => (
                <TableRow
                  key={opp.id}
                  className={cn(
                    opp.status === 'active' && 'bg-green-50/50',
                    opp.status === 'purchased' && 'opacity-60'
                  )}
                >
                  <TableCell className="font-mono font-medium">
                    {opp.set_number}
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    <div className="flex items-center gap-1">
                      <span className="truncate">{opp.set_name || '-'}</span>
                      <a
                        href={opp.vinted_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-600 hover:text-purple-800 flex-shrink-0"
                        title="View on Vinted"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(opp.vinted_price)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {formatCurrency(opp.amazon_price)}
                      {opp.asin && (
                        <>
                          <a
                            href={`https://www.amazon.co.uk/dp/${opp.asin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800"
                            title="View on Amazon"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <a
                            href={`https://sas.selleramp.com/sas/lookup?SasLookup%5Bsearch_term%5D=${opp.asin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-orange-600 hover:text-orange-800"
                            title="View in SellerAmp"
                          >
                            <span className="text-[10px] font-bold">SAS</span>
                          </a>
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {getCogBadge(opp.cog_percent)}
                  </TableCell>
                  <TableCell className="text-right font-medium text-green-600">
                    {formatCurrency(opp.estimated_profit)}
                  </TableCell>
                  <TableCell>{getStatusBadge(opp.status)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(opp.found_at), {
                      addSuffix: true,
                    })}
                  </TableCell>
                  <TableCell>
                    {opp.status === 'active' && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStatusChange(opp.id, 'purchased')}
                          disabled={updateStatus.isPending}
                          title="Mark as purchased"
                        >
                          <ShoppingCart className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleStatusChange(opp.id, 'dismissed')}
                          disabled={updateStatus.isPending}
                          title="Dismiss"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
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

function OpportunitiesTableSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
