'use client';

import { useState, useMemo } from 'react';
import { Search, Calendar, Upload } from 'lucide-react';
import { useUnlinkedBrickLinkUploads } from '@/hooks/use-bricklink-uploads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useDebouncedCallback } from 'use-debounce';

interface LinkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (uploadId: string) => void;
  purchaseDate?: string;
}

export function LinkUploadDialog({
  open,
  onOpenChange,
  onSelect,
  purchaseDate,
}: LinkUploadDialogProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showPriorUploads, setShowPriorUploads] = useState(false);

  const debouncedSetSearch = useDebouncedCallback((value: string) => {
    setDebouncedSearch(value);
  }, 300);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    debouncedSetSearch(value);
  };

  // Fetch unlinked uploads
  const { data: uploadsData, isLoading } = useUnlinkedBrickLinkUploads(
    debouncedSearch ? { search: debouncedSearch } : undefined,
    { page: 1, pageSize: 50 }
  );

  // Filter and sort uploads: ascending by date from purchase date, filtering out prior uploads unless toggled
  const sortedUploads = useMemo(() => {
    if (!uploadsData?.data) return [];
    if (!purchaseDate) {
      // No purchase date - just sort by upload date ascending
      return [...uploadsData.data].sort(
        (a, b) => new Date(a.upload_date).getTime() - new Date(b.upload_date).getTime()
      );
    }

    const purchaseTime = new Date(purchaseDate).getTime();

    // Filter out uploads before purchase date unless toggle is on
    let filtered = uploadsData.data;
    if (!showPriorUploads) {
      filtered = uploadsData.data.filter(
        (upload) => new Date(upload.upload_date).getTime() >= purchaseTime
      );
    }

    // Sort by date ascending (earliest first from purchase date)
    return [...filtered].sort(
      (a, b) => new Date(a.upload_date).getTime() - new Date(b.upload_date).getTime()
    );
  }, [uploadsData?.data, purchaseDate, showPriorUploads]);

  // Count how many uploads are hidden (before purchase date)
  const hiddenCount = useMemo(() => {
    if (!uploadsData?.data || !purchaseDate || showPriorUploads) return 0;
    const purchaseTime = new Date(purchaseDate).getTime();
    return uploadsData.data.filter(
      (upload) => new Date(upload.upload_date).getTime() < purchaseTime
    ).length;
  }, [uploadsData?.data, purchaseDate, showPriorUploads]);

  const handleSelect = (uploadId: string) => {
    onSelect(uploadId);
    setSearch('');
    setDebouncedSearch('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Link BrickLink Upload</DialogTitle>
          <DialogDescription>
            Select an unlinked upload to associate with this purchase. Uploads are sorted by date,
            showing those on or after the purchase date.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search uploads..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Toggle to show uploads before purchase date */}
          {purchaseDate && (
            <div className="flex items-center justify-between">
              <Label htmlFor="show-prior" className="text-sm text-muted-foreground">
                Show uploads before purchase date
                {hiddenCount > 0 && !showPriorUploads && (
                  <span className="ml-1">({hiddenCount} hidden)</span>
                )}
              </Label>
              <Switch
                id="show-prior"
                checked={showPriorUploads}
                onCheckedChange={setShowPriorUploads}
              />
            </div>
          )}

          <ScrollArea className="h-[300px] rounded-md border">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-pulse text-muted-foreground">Loading uploads...</div>
              </div>
            ) : sortedUploads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Upload className="h-8 w-8 mb-2" />
                <p>No unlinked uploads found</p>
                <p className="text-xs mt-1">All uploads may already be linked to purchases</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {sortedUploads.map((upload) => {
                  // Calculate days difference from purchase date
                  let daysDiff: number | null = null;
                  if (purchaseDate) {
                    const purchaseTime = new Date(purchaseDate).getTime();
                    const uploadTime = new Date(upload.upload_date).getTime();
                    daysDiff = Math.round((uploadTime - purchaseTime) / (1000 * 60 * 60 * 24));
                  }

                  return (
                    <Button
                      key={upload.id}
                      variant="ghost"
                      className="w-full justify-start h-auto py-3 px-3"
                      onClick={() => handleSelect(upload.id)}
                    >
                      <div className="flex flex-col items-start gap-1 text-left w-full">
                        <div className="flex items-center justify-between w-full">
                          <span className="font-medium flex items-center gap-2">
                            <Calendar className="h-3 w-3" />
                            {formatDate(upload.upload_date)}
                            <Badge
                              variant={upload.condition === 'N' ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {upload.condition === 'N' ? 'New' : 'Used'}
                            </Badge>
                          </span>
                          <span className="font-medium text-sm text-green-600">
                            {formatCurrency(upload.selling_price)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            {upload.total_quantity.toLocaleString()} parts
                            {upload.lots ? ` \u00b7 ${upload.lots.toLocaleString()} lots` : ''}
                          </span>
                          {upload.source && (
                            <Badge variant="outline" className="text-xs py-0">
                              {upload.source}
                            </Badge>
                          )}
                          {daysDiff !== null && (
                            <span className="text-xs">
                              {daysDiff === 0
                                ? 'Same day as purchase'
                                : daysDiff > 0
                                  ? `${daysDiff}d after purchase`
                                  : `${Math.abs(daysDiff)}d before purchase`}
                            </span>
                          )}
                        </div>
                      </div>
                    </Button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
