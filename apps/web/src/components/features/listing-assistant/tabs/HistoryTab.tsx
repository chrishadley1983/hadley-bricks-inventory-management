'use client';

import { useState, useCallback } from 'react';
import { Copy, Trash2, Check, History, Package } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useListings, useDeleteListing } from '@/hooks/listing-assistant';
import { STATUS_COLORS, CONDITION_COLORS } from '@/lib/listing-assistant/constants';
import type { GeneratedListing } from '@/lib/listing-assistant/types';

export function HistoryTab() {
  const { data, isLoading, error } = useListings();
  const deleteMutation = useDeleteListing();
  const { toast } = useToast();

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const listings = data?.data || [];

  const handleCopy = useCallback(
    (listing: GeneratedListing) => {
      navigator.clipboard.writeText(listing.description);
      setCopiedId(listing.id);
      setTimeout(() => setCopiedId(null), 2000);
      toast({ title: 'HTML copied to clipboard' });
    },
    [toast]
  );

  const handleDelete = async () => {
    if (!deleteConfirmId) return;

    try {
      await deleteMutation.mutateAsync(deleteConfirmId);
      toast({ title: 'Listing deleted' });
      setDeleteConfirmId(null);
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-destructive">Failed to load listings. Please try again.</p>
      </Card>
    );
  }

  if (listings.length === 0) {
    return (
      <Card className="p-8 text-center">
        <History className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No saved listings</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Generated listings will appear here when you save them.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Saved Listings</h2>
          <p className="text-sm text-muted-foreground">
            {listings.length} listing{listings.length !== 1 ? 's' : ''} saved
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {listings.map((listing) => (
          <Card key={listing.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base truncate">{listing.title}</CardTitle>
                  <CardDescription className="flex items-center gap-2 mt-1 flex-wrap">
                    <span>{formatDate(listing.created_at)}</span>
                    <span>&middot;</span>
                    <span>{listing.item_name}</span>
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {listing.price_range && (
                    <Badge variant="outline">{listing.price_range}</Badge>
                  )}
                  <Badge className={CONDITION_COLORS[listing.condition]}>
                    {listing.condition}
                  </Badge>
                  <Badge className={STATUS_COLORS[listing.status]}>
                    {listing.status}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Description Preview */}
              <div
                className="text-sm text-muted-foreground line-clamp-3 prose prose-sm max-w-none mb-4"
                dangerouslySetInnerHTML={{
                  __html: listing.description.substring(0, 500),
                }}
              />

              {/* Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy(listing)}
                >
                  {copiedId === listing.id ? (
                    <>
                      <Check className="mr-2 h-3 w-3" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-3 w-3" />
                      Copy HTML
                    </>
                  )}
                </Button>

                {listing.inventory_item_id && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/inventory/${listing.inventory_item_id}`}>
                      <Package className="mr-2 h-3 w-3" />
                      View Item
                    </Link>
                  </Button>
                )}

                <div className="flex-1" />

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirmId(listing.id)}
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Listing</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this saved listing? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
