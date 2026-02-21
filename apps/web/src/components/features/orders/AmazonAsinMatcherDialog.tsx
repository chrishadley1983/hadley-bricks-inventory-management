'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDebouncedCallback } from 'use-debounce';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, CheckCircle2, Package, MapPin, AlertTriangle, Link2 } from 'lucide-react';

interface InventoryItem {
  id: string;
  set_number: string;
  item_name: string | null;
  condition: string | null;
  status: string | null;
  storage_location: string | null;
  sku: string | null;
  amazon_asin: string | null;
  cost: number | null;
  sold_platform: string | null;
  sold_order_id: string | null;
  listing_platform: string | null;
}

interface AmazonAsinMatcherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asin: string;
  itemTitle: string;
  orderId: string;
  onSuccess?: () => void;
}

async function searchInventory(query: string): Promise<{ data: InventoryItem[]; total: number }> {
  // Search for items that can be matched:
  // 1. Non-sold items (BACKLOG, LISTED, AVAILABLE)
  // 2. SOLD items on Amazon without a linked order yet
  const params = new URLSearchParams({
    search: query,
    pageSize: '50',
    status: 'BACKLOG,LISTED,AVAILABLE,SOLD', // Include SOLD for Amazon matching
  });
  const response = await fetch(`/api/inventory?${params}`);
  if (!response.ok) throw new Error('Failed to search inventory');
  const result = await response.json();

  // Filter results: include non-SOLD items, or SOLD items on Amazon without linked order
  const filteredData = (result.data?.data || []).filter((item: InventoryItem) => {
    if (item.status !== 'SOLD') {
      return true; // Non-sold items are always eligible
    }
    // SOLD items: must be sold/listed on Amazon and not have a linked order
    // Check sold_platform first, fall back to listing_platform if not set
    const platform = item.sold_platform || item.listing_platform;
    const isAmazon = platform?.toLowerCase() === 'amazon';
    const hasNoLinkedOrder = !item.sold_order_id;
    return isAmazon && hasNoLinkedOrder;
  });

  return { data: filteredData, total: filteredData.length };
}

async function updateInventoryAsin(inventoryItemId: string, asin: string) {
  const response = await fetch(`/api/inventory/${inventoryItemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amazon_asin: asin }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to update inventory ASIN');
  }
  return response.json();
}

async function triggerOrderRematch(orderId: string) {
  const response = await fetch(`/api/orders/amazon/${orderId}/rematch`, {
    method: 'POST',
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to trigger order re-match');
  }
  return response.json();
}

export function AmazonAsinMatcherDialog({
  open,
  onOpenChange,
  asin,
  itemTitle,
  orderId,
  onSuccess,
}: AmazonAsinMatcherDialogProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setDebouncedQuery(value);
  }, 300);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    debouncedSearch(value);
  };

  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['inventory', 'search', debouncedQuery],
    queryFn: () => searchInventory(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
  });

  const updateAsinMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error('No item selected');
      // First, update the inventory item with the ASIN
      await updateInventoryAsin(selectedItem.id, asin);
      // Then trigger the order re-match to link the inventory
      await triggerOrderRematch(orderId);
    },
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['amazon', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onSuccess?.();
      onOpenChange(false);
      // Reset state
      setSearchQuery('');
      setDebouncedQuery('');
      setSelectedItem(null);
    },
  });

  const handleClose = () => {
    onOpenChange(false);
    setSearchQuery('');
    setDebouncedQuery('');
    setSelectedItem(null);
    updateAsinMutation.reset();
  };

  const items = searchResults?.data || [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Link Amazon Item to Inventory
          </DialogTitle>
          <DialogDescription>
            Search for an inventory item to link to this ASIN. This will set the Amazon ASIN on the
            inventory item for future matching.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Amazon Item Info */}
          <div className="rounded-lg border bg-muted/50 p-4">
            <div className="text-sm font-medium text-muted-foreground mb-1">Amazon Item</div>
            <div className="font-medium">{itemTitle}</div>
            <div className="text-sm text-muted-foreground mt-1">
              ASIN: <span className="font-mono">{asin}</span>
            </div>
          </div>

          {/* Search */}
          <div className="space-y-2">
            <Label htmlFor="inventory-search">Search Inventory</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="inventory-search"
                placeholder="Search by set number, name, or SKU..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9"
                autoFocus
              />
            </div>
          </div>

          {/* Search Results */}
          <div className="space-y-2">
            <Label>
              {debouncedQuery.length >= 2
                ? `Results ${items.length > 0 ? `(${items.length})` : ''}`
                : 'Enter at least 2 characters to search'}
            </Label>
            <ScrollArea className="h-[250px] rounded-md border">
              {isSearching ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : items.length === 0 && debouncedQuery.length >= 2 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Package className="h-8 w-8 mb-2 opacity-50" />
                  <p>No inventory items found</p>
                  <p className="text-sm">Try a different search term</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`w-full text-left p-3 rounded-md border transition-colors ${
                        selectedItem?.id === item.id
                          ? 'border-primary bg-primary/5'
                          : 'border-transparent hover:bg-muted'
                      }`}
                      onClick={() => setSelectedItem(item)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{item.set_number}</span>
                            {item.condition && (
                              <Badge variant="outline" className="text-xs">
                                {item.condition}
                              </Badge>
                            )}
                            {item.status && (
                              <Badge
                                className={`text-xs ${
                                  item.status === 'LISTED'
                                    ? 'bg-blue-100 text-blue-800'
                                    : item.status === 'BACKLOG'
                                      ? 'bg-yellow-100 text-yellow-800'
                                      : item.status === 'SOLD'
                                        ? 'bg-purple-100 text-purple-800'
                                        : 'bg-green-100 text-green-800'
                                }`}
                              >
                                {item.status}
                              </Badge>
                            )}
                            {item.status === 'SOLD' && item.sold_platform && (
                              <Badge
                                variant="outline"
                                className="text-xs text-orange-600 border-orange-300"
                              >
                                {item.sold_platform}
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground truncate">
                            {item.item_name || 'No name'}
                          </div>
                          <div className="flex items-center gap-4 mt-1">
                            {item.storage_location && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                {item.storage_location}
                              </div>
                            )}
                            {item.amazon_asin && (
                              <div className="text-xs text-orange-600">
                                Has ASIN: {item.amazon_asin}
                              </div>
                            )}
                          </div>
                        </div>
                        {selectedItem?.id === item.id && (
                          <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Warning if item already has ASIN */}
          {selectedItem?.amazon_asin && selectedItem.amazon_asin !== asin && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This inventory item already has a different ASIN ({selectedItem.amazon_asin}).
                Linking will replace it with {asin}.
              </AlertDescription>
            </Alert>
          )}

          {/* Error Message */}
          {updateAsinMutation.isError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {updateAsinMutation.error instanceof Error
                  ? updateAsinMutation.error.message
                  : 'Failed to update ASIN'}
              </AlertDescription>
            </Alert>
          )}

          {/* Success Message */}
          {updateAsinMutation.isSuccess && (
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                ASIN linked to inventory item successfully!
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => updateAsinMutation.mutate()}
            disabled={!selectedItem || updateAsinMutation.isPending}
          >
            {updateAsinMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Linking...
              </>
            ) : (
              <>
                <Link2 className="mr-2 h-4 w-4" />
                Link Item
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
