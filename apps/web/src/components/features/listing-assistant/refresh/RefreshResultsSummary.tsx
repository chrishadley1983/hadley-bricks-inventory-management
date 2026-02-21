'use client';

import { CheckCircle2, XCircle, SkipForward, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import type { RefreshResult } from '@/lib/ebay/listing-refresh.types';

interface RefreshResultsSummaryProps {
  result: RefreshResult;
  onDismiss: () => void;
}

/**
 * Summary of refresh operation results
 */
export function RefreshResultsSummary({ result, onDismiss }: RefreshResultsSummaryProps) {
  const successRate =
    result.totalProcessed > 0 ? Math.round((result.createdCount / result.totalProcessed) * 100) : 0;

  return (
    <Card className={result.success ? 'border-green-200' : 'border-amber-200'}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {result.success ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            )}
            <CardTitle>
              {result.success ? 'Refresh Complete' : 'Refresh Completed with Issues'}
            </CardTitle>
          </div>
          <Button variant="outline" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
        <CardDescription>
          {result.createdCount} of {result.totalProcessed} listings refreshed successfully (
          {successRate}% success rate)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Created</span>
            </div>
            <p className="text-2xl font-bold mt-1">{result.createdCount}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-sm text-muted-foreground">Ended</span>
            </div>
            <p className="text-2xl font-bold mt-1">{result.endedCount}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm text-muted-foreground">Failed</span>
            </div>
            <p className="text-2xl font-bold mt-1">{result.failedCount}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              <SkipForward className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Skipped</span>
            </div>
            <p className="text-2xl font-bold mt-1">{result.skippedCount}</p>
          </div>
        </div>

        {/* Errors List */}
        {result.errors.length > 0 && (
          <Accordion type="single" collapsible>
            <AccordionItem value="errors">
              <AccordionTrigger className="text-sm">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  {result.errors.length} Error{result.errors.length !== 1 ? 's' : ''}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {result.errors.map((error, index) => (
                    <div
                      key={`${error.itemId}-${index}`}
                      className="p-3 rounded bg-red-50 dark:bg-red-950/20 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{error.title}</p>
                          <p className="text-muted-foreground text-xs mt-1">
                            Item ID: {error.itemId}
                          </p>
                        </div>
                        <Badge variant="outline" className="capitalize">
                          {error.phase}
                        </Badge>
                      </div>
                      <p className="mt-2 text-red-600 dark:text-red-400">
                        {error.errorMessage}
                        {error.errorCode && (
                          <span className="text-muted-foreground ml-1">
                            (Code: {error.errorCode})
                          </span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
