'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, AlertTriangle, Copy } from 'lucide-react';
import { usePerfPage } from '@/hooks/use-perf';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEbaySkuIssues } from '@/hooks/use-ebay-stock';
import { useToast } from '@/hooks/use-toast';

// Dynamic import for Header
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

export default function SkuIssuesPage() {
  usePerfPage('SkuIssuesPage');
  const { toast } = useToast();
  const { data, isLoading, error } = useEbaySkuIssues();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied',
      description: 'Item ID copied to clipboard',
    });
  };

  // Loading state
  if (isLoading) {
    return (
      <>
        <Header title="SKU Issues" />
        <div className="p-6 space-y-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 w-10" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-96" />
            </div>
          </div>
          <Skeleton className="h-10 w-80" />
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-2">
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  // Error state
  if (error) {
    return (
      <>
        <Header title="SKU Issues" />
        <div className="p-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8 text-muted-foreground">
                <p>Failed to load SKU issues</p>
                <p className="text-sm">{error.message}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const { issues, summary } = data || {
    issues: [],
    summary: { emptySkuCount: 0, duplicateSkuCount: 0, totalIssueCount: 0 },
  };

  const emptySkuIssues = issues.filter((i) => i.issueType === 'empty');
  const duplicateSkuIssues = issues.filter((i) => i.issueType === 'duplicate');

  // Group duplicates by SKU
  const duplicateGroups = new Map<string, typeof issues>();
  for (const issue of duplicateSkuIssues) {
    if (!issue.sku) continue;
    if (!duplicateGroups.has(issue.sku)) {
      duplicateGroups.set(issue.sku, []);
    }
    duplicateGroups.get(issue.sku)!.push(issue);
  }

  return (
    <>
      <Header title="SKU Issues" />
      <div className="p-6 space-y-6">
        {/* Back button and header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/ebay-stock">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">eBay SKU Issues</h1>
            <p className="text-muted-foreground">
              Fix these issues on eBay for accurate stock comparison. SKUs must be unique and
              non-empty to match with inventory.
            </p>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Issues
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{summary.totalIssueCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Empty SKUs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.emptySkuCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Duplicate SKUs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.duplicateSkuCount}</div>
            </CardContent>
          </Card>
        </div>

        {/* No issues state */}
        {summary.totalIssueCount === 0 && (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-600 mb-4">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No SKU Issues Found</h3>
                <p className="text-muted-foreground">
                  All your eBay listings have valid, unique SKUs.
                </p>
                <Button variant="outline" className="mt-4" asChild>
                  <Link href="/ebay-stock">Back to eBay Stock</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Issues tabs */}
        {summary.totalIssueCount > 0 && (
          <Tabs defaultValue={emptySkuIssues.length > 0 ? 'empty' : 'duplicate'}>
            <TabsList>
              <TabsTrigger value="empty" disabled={emptySkuIssues.length === 0}>
                Empty SKUs ({emptySkuIssues.length})
              </TabsTrigger>
              <TabsTrigger value="duplicate" disabled={duplicateGroups.size === 0}>
                Duplicate SKUs ({duplicateGroups.size})
              </TabsTrigger>
            </TabsList>

            {/* Empty SKUs Tab */}
            <TabsContent value="empty" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Listings with Empty SKUs</CardTitle>
                  <CardDescription>
                    These listings have no SKU set. Add a unique SKU to each listing on eBay.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item ID</TableHead>
                          <TableHead className="min-w-[200px]">Title</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {emptySkuIssues.map((issue) => (
                          <TableRow key={issue.id}>
                            <TableCell className="font-mono text-sm">
                              <div className="flex items-center gap-2">
                                {issue.viewItemUrl ? (
                                  <a
                                    href={issue.viewItemUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:underline text-blue-600"
                                  >
                                    {issue.itemId}
                                  </a>
                                ) : (
                                  issue.itemId
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => copyToClipboard(issue.itemId)}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[300px] truncate" title={issue.title}>
                              {issue.title || '-'}
                            </TableCell>
                            <TableCell className="text-right">{issue.quantity}</TableCell>
                            <TableCell className="text-right">
                              {issue.price
                                ? new Intl.NumberFormat('en-GB', {
                                    style: 'currency',
                                    currency: 'GBP',
                                  }).format(issue.price)
                                : '-'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{issue.listingStatus}</Badge>
                            </TableCell>
                            <TableCell>
                              {issue.viewItemUrl && (
                                <Button variant="ghost" size="sm" asChild>
                                  <a
                                    href={issue.viewItemUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Duplicate SKUs Tab */}
            <TabsContent value="duplicate" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Duplicate SKUs</CardTitle>
                  <CardDescription>
                    These SKUs are used by multiple listings. Each SKU should be unique. Update the
                    SKUs on eBay to make them unique.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {Array.from(duplicateGroups.entries()).map(([sku, items]) => (
                    <div key={sku} className="rounded-lg border p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Badge variant="destructive">Duplicate</Badge>
                        <span className="font-mono font-medium">{sku}</span>
                        <span className="text-sm text-muted-foreground">
                          ({items.length} listings)
                        </span>
                      </div>
                      <div className="rounded-md border overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Item ID</TableHead>
                              <TableHead className="min-w-[200px]">Title</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead className="text-right">Price</TableHead>
                              <TableHead></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {items.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell className="font-mono text-sm">
                                  <div className="flex items-center gap-2">
                                    {item.viewItemUrl ? (
                                      <a
                                        href={item.viewItemUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:underline text-blue-600"
                                      >
                                        {item.itemId}
                                      </a>
                                    ) : (
                                      item.itemId
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6"
                                      onClick={() => copyToClipboard(item.itemId)}
                                    >
                                      <Copy className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </TableCell>
                                <TableCell className="max-w-[300px] truncate" title={item.title}>
                                  {item.title || '-'}
                                </TableCell>
                                <TableCell className="text-right">{item.quantity}</TableCell>
                                <TableCell className="text-right">
                                  {item.price
                                    ? new Intl.NumberFormat('en-GB', {
                                        style: 'currency',
                                        currency: 'GBP',
                                      }).format(item.price)
                                    : '-'}
                                </TableCell>
                                <TableCell>
                                  {item.viewItemUrl && (
                                    <Button variant="ghost" size="sm" asChild>
                                      <a
                                        href={item.viewItemUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        <ExternalLink className="h-4 w-4" />
                                      </a>
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}
