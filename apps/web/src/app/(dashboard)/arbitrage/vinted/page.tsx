/**
 * Vinted LEGO Arbitrage Page
 *
 * Scan Vinted listings and compare against Amazon Buy Box prices to find arbitrage opportunities.
 */

'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePerfPage } from '@/hooks/use-perf';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Loader2, Search, ExternalLink, TrendingUp, AlertCircle, Zap } from 'lucide-react';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

const DEFAULT_VINTED_URL = 'https://www.vinted.co.uk/catalog?search_text=lego&status_ids[]=6&order=newest_first';

interface ArbitrageResult {
  setNumber: string;
  title: string;
  vintedPrice: number;
  totalCost: number;
  amazonPrice: number | null;
  amazonBuyBox: number | null;
  amazonWasPrice: number | null;
  cogPercent: number | null;
  profit: number | null;
  roi: number | null;
  viable: boolean;
  asin: string | null;
  vintedUrl?: string;
}

interface ScanResponse {
  summary: {
    totalListings: number;
    identifiedSets: number;
    uniqueSets: number;
    withAmazonPricing: number;
    viableOpportunities: number;
    cogThreshold: number;
  };
  results: ArbitrageResult[];
  viable: ArbitrageResult[];
}

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
  if (cogPercent < 60) {
    return <Badge className="bg-orange-500">{cogPercent.toFixed(0)}% Poor</Badge>;
  }
  return <Badge className="bg-red-500">{cogPercent.toFixed(0)}% Not viable</Badge>;
}

function formatCurrency(value: number | null): string {
  if (value === null) return '-';
  return `£${value.toFixed(2)}`;
}

export default function VintedArbitragePage() {
  usePerfPage('VintedArbitragePage');
  const [vintedUrl, setVintedUrl] = useState(DEFAULT_VINTED_URL);
  const [cogThreshold, setCogThreshold] = useState(40);

  const scanMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({
        url: vintedUrl,
        cogThreshold: cogThreshold.toString(),
      });

      const response = await fetch(`/api/arbitrage/vinted?${params}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Scan failed');
      }
      return response.json() as Promise<ScanResponse>;
    },
  });

  const { data, isPending: isLoading, error } = scanMutation;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Vinted LEGO Arbitrage</h1>
          <p className="text-muted-foreground">
            Manual scanning - compare Vinted listings against Amazon prices
          </p>
        </div>
        <Link href="/arbitrage/vinted/automation">
          <Button variant="outline">
            <Zap className="mr-2 h-4 w-4" />
            Automated Scanner
          </Button>
        </Link>
      </div>

      {/* Scan Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Scan Vinted</CardTitle>
          <CardDescription>
            Enter a Vinted catalog URL to scan for LEGO arbitrage opportunities
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url">Vinted URL</Label>
            <div className="flex gap-2">
              <Input
                id="url"
                value={vintedUrl}
                onChange={(e) => setVintedUrl(e.target.value)}
                placeholder="https://www.vinted.co.uk/catalog?search_text=lego..."
                className="flex-1"
              />
              <Button onClick={() => scanMutation.mutate()} disabled={isLoading || !vintedUrl}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Scan
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>COG% Threshold: {cogThreshold}%</Label>
            <Slider
              value={[cogThreshold]}
              onValueChange={(values: number[]) => setCogThreshold(values[0])}
              min={20}
              max={60}
              step={5}
              className="w-64"
            />
            <p className="text-sm text-muted-foreground">
              Items below this COG% are marked as viable opportunities
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              <span>{error instanceof Error ? error.message : 'Scan failed'}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      {data && (
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Listings</CardDescription>
              <CardTitle className="text-2xl">{data.summary.totalListings}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Identified Sets</CardDescription>
              <CardTitle className="text-2xl">{data.summary.identifiedSets}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Unique Sets</CardDescription>
              <CardTitle className="text-2xl">{data.summary.uniqueSets}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>With Amazon Pricing</CardDescription>
              <CardTitle className="text-2xl">{data.summary.withAmazonPricing}</CardTitle>
            </CardHeader>
          </Card>
          <Card
            className={data.summary.viableOpportunities > 0 ? 'border-green-500 bg-green-50' : ''}
          >
            <CardHeader className="pb-2">
              <CardDescription>Viable Opportunities</CardDescription>
              <CardTitle className="text-2xl text-green-600">
                {data.summary.viableOpportunities}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* Viable Opportunities */}
      {data && data.viable.length > 0 && (
        <Card className="border-green-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
              Potential Buys (COG% &lt;= {cogThreshold}%)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Set</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right">Vinted</TableHead>
                  <TableHead className="text-right">Amazon</TableHead>
                  <TableHead className="text-right">COG%</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">ROI</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.viable.map((item) => (
                  <TableRow key={item.setNumber} className="bg-green-50/50">
                    <TableCell className="font-mono font-medium">{item.setNumber}</TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="flex items-center gap-1">
                        <span className="truncate">{item.title}</span>
                        {item.vintedUrl && (
                          <a
                            href={item.vintedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-600 hover:text-purple-800 flex-shrink-0"
                            title="View on Vinted"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(item.vintedPrice)}</TableCell>
                    <TableCell className="text-right">
                      <div>{formatCurrency(item.amazonBuyBox || item.amazonPrice)}</div>
                      {item.amazonWasPrice && item.amazonWasPrice !== item.amazonBuyBox && (
                        <div className="text-xs text-muted-foreground line-through">
                          {formatCurrency(item.amazonWasPrice)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{getCogBadge(item.cogPercent)}</TableCell>
                    <TableCell className="text-right text-green-600 font-medium">
                      {formatCurrency(item.profit)}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.roi !== null ? `${item.roi.toFixed(0)}%` : '-'}
                    </TableCell>
                    <TableCell>
                      {item.asin && (
                        <a
                          href={`https://www.amazon.co.uk/dp/${item.asin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* All Results */}
      {data && data.results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>All Identified Sets ({data.results.length})</CardTitle>
            <CardDescription>Sorted by COG% (lowest first)</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Set</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right">Vinted</TableHead>
                  <TableHead className="text-right">+Ship</TableHead>
                  <TableHead className="text-right">Buy Box</TableHead>
                  <TableHead className="text-right">Was Price</TableHead>
                  <TableHead className="text-right">COG%</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.results.map((item, idx) => (
                  <TableRow
                    key={`${item.setNumber}-${item.vintedPrice}-${idx}`}
                    className={cn(item.viable && 'bg-green-50/50')}
                  >
                    <TableCell className="font-mono font-medium">{item.setNumber}</TableCell>
                    <TableCell className="max-w-[200px]" title={item.title}>
                      <div className="flex items-center gap-1">
                        <span className="truncate">{item.title}</span>
                        {item.vintedUrl && (
                          <a
                            href={item.vintedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-600 hover:text-purple-800 flex-shrink-0"
                            title="View on Vinted"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(item.vintedPrice)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatCurrency(item.totalCost)}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(item.amazonBuyBox)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {item.amazonWasPrice ? formatCurrency(item.amazonWasPrice) : '-'}
                    </TableCell>
                    <TableCell className="text-right">{getCogBadge(item.cogPercent)}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium',
                        item.profit && item.profit > 0 ? 'text-green-600' : 'text-red-600'
                      )}
                    >
                      {formatCurrency(item.profit)}
                    </TableCell>
                    <TableCell>
                      {item.asin && (
                        <a
                          href={`https://www.amazon.co.uk/dp/${item.asin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* COG% Legend */}
      <Card>
        <CardHeader>
          <CardTitle>COG% Reference</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-5">
            <div className="flex items-center gap-2">
              <Badge className="bg-green-600">&lt;30%</Badge>
              <span className="text-sm">Excellent</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-green-500">30-40%</Badge>
              <span className="text-sm">Good (Target)</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-yellow-500">40-50%</Badge>
              <span className="text-sm">Marginal</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-orange-500">50-60%</Badge>
              <span className="text-sm">Poor</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-red-500">&gt;60%</Badge>
              <span className="text-sm">Not viable</span>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            <strong>Formula:</strong> COG% = (Vinted Price + £2.30 shipping) / Amazon Price x 100
            <br />
            At 40% COG, ~30% profit remains after Amazon FBM fees (~18%) and customer shipping (~12%).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
