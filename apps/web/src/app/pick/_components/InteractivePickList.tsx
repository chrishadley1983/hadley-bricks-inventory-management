'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, MapPin, Package, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PickItem {
  location: string | null;
  setNo: string | null;
  itemName: string;
  orderId: string;
  quantity: number;
  matchStatus: string;
  // Amazon-specific
  asin?: string | null;
  amazonOrderId?: string;
  // eBay-specific
  ebayOrderId?: string;
}

interface PickListData {
  items: PickItem[];
  unmatchedItems: PickItem[];
  unknownLocationItems: PickItem[];
  totalItems: number;
  totalOrders: number;
  generatedAt: string;
}

interface ItemState {
  picked: boolean;
  notes: string;
}

type PickState = Record<string, ItemState>;

interface InteractivePickListProps {
  platform: 'amazon' | 'ebay';
  data: Record<string, unknown>;
  generatedAt: string;
}

function getStorageKey(platform: string, generatedAt: string) {
  return `picklist-state-${platform}-${generatedAt}`;
}

function getItemKey(item: PickItem, index: number) {
  return `${item.orderId}-${index}`;
}

function cleanOldKeys(platform: string, currentKey: string) {
  const prefix = `picklist-state-${platform}-`;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix) && key !== currentKey) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}

export function InteractivePickList({ platform, data, generatedAt }: InteractivePickListProps) {
  const pickData = data as unknown as PickListData;
  const storageKey = getStorageKey(platform, generatedAt);

  const [state, setState] = useState<PickState>({});
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        setState(JSON.parse(saved));
      }
      cleanOldKeys(platform, storageKey);
    } catch {
      // Ignore parse errors
    }
    setHydrated(true);
  }, [storageKey, platform]);

  // Persist to localStorage on change
  useEffect(() => {
    if (hydrated) {
      localStorage.setItem(storageKey, JSON.stringify(state));
    }
  }, [state, storageKey, hydrated]);

  const togglePicked = useCallback((key: string) => {
    setState((prev) => ({
      ...prev,
      [key]: {
        picked: !prev[key]?.picked,
        notes: prev[key]?.notes || '',
      },
    }));
  }, []);

  const setNotes = useCallback((key: string, notes: string) => {
    setState((prev) => ({
      ...prev,
      [key]: {
        picked: prev[key]?.picked || false,
        notes,
      },
    }));
  }, []);

  // Group items by location
  const itemsByLocation = new Map<string, { item: PickItem; index: number }[]>();
  pickData.items.forEach((item, index) => {
    const loc = item.location || 'Unknown Location';
    if (!itemsByLocation.has(loc)) {
      itemsByLocation.set(loc, []);
    }
    itemsByLocation.get(loc)!.push({ item, index });
  });

  // Calculate progress
  const totalItems = pickData.items.length;
  const pickedCount = pickData.items.filter(
    (_, i) => state[getItemKey(pickData.items[i], i)]?.picked
  ).length;
  const progressPct = totalItems > 0 ? (pickedCount / totalItems) * 100 : 0;
  const allDone = pickedCount === totalItems && totalItems > 0;

  const platformLabel = platform === 'amazon' ? 'Amazon' : 'eBay';
  const generatedDate = new Date(generatedAt).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const getOrderId = (item: PickItem) =>
    item.amazonOrderId || item.ebayOrderId || item.orderId;

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {platformLabel} Pick List
            </CardTitle>
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary">{pickData.totalOrders} orders</Badge>
              <Badge variant="secondary">{pickData.totalItems} items</Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Generated {generatedDate}</p>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center gap-3">
            <Progress value={progressPct} className="flex-1" />
            <span className="text-sm font-medium whitespace-nowrap">
              {pickedCount}/{totalItems} picked
            </span>
          </div>
          {allDone && (
            <div className="flex items-center gap-2 mt-3 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm font-medium">All items picked!</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Warnings */}
      {pickData.unmatchedItems.length > 0 && (
        <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 dark:text-amber-200">
            <strong>{pickData.unmatchedItems.length} unmatched item(s)</strong> — no inventory match
            found.
          </AlertDescription>
        </Alert>
      )}

      {pickData.unknownLocationItems.length > 0 && (
        <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900">
          <MapPin className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 dark:text-amber-200">
            <strong>{pickData.unknownLocationItems.length} item(s)</strong> have no storage location
            set.
          </AlertDescription>
        </Alert>
      )}

      {/* No items */}
      {totalItems === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
          <p className="text-muted-foreground">No orders awaiting dispatch</p>
        </div>
      )}

      {/* Pick list grouped by location */}
      {Array.from(itemsByLocation.entries()).map(([location, entries]) => {
        const locationPickedCount = entries.filter(
          ({ item, index }) => state[getItemKey(item, index)]?.picked
        ).length;

        return (
          <Card key={location}>
            <div className="bg-muted px-4 py-2.5 font-medium flex items-center gap-2 rounded-t-lg border-b">
              <MapPin className="h-4 w-4" />
              {location}
              <Badge variant="secondary" className="ml-auto">
                {locationPickedCount}/{entries.length}
              </Badge>
            </div>
            <div className="divide-y">
              {entries.map(({ item, index }) => {
                const key = getItemKey(item, index);
                const itemState = state[key];
                const isPicked = itemState?.picked || false;

                return (
                  <div
                    key={key}
                    className={cn(
                      'px-4 py-3 flex items-start gap-3 transition-colors',
                      isPicked && 'bg-green-50/60 dark:bg-green-950/10',
                      item.matchStatus === 'unmatched' &&
                        !isPicked &&
                        'bg-amber-50/50 dark:bg-amber-950/10'
                    )}
                  >
                    {/* Checkbox */}
                    <Checkbox
                      checked={isPicked}
                      onCheckedChange={() => togglePicked(key)}
                      className="mt-1 h-5 w-5"
                    />

                    {/* Item details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'font-medium text-sm',
                            isPicked && 'line-through text-muted-foreground'
                          )}
                        >
                          {item.setNo || item.asin || '-'}
                        </span>
                        {item.matchStatus === 'unmatched' && (
                          <Badge
                            variant="outline"
                            className="text-amber-600 border-amber-500 text-xs"
                          >
                            Unmatched
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-xs">
                          x{item.quantity}
                        </Badge>
                      </div>
                      <p
                        className={cn(
                          'text-sm text-muted-foreground mt-0.5 line-clamp-2',
                          isPicked && 'line-through'
                        )}
                      >
                        {item.itemName}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Order: {getOrderId(item)}
                      </p>

                      {/* Inline notes */}
                      <Input
                        placeholder="Add a note..."
                        value={itemState?.notes || ''}
                        onChange={(e) => setNotes(key, e.target.value)}
                        className="mt-2 h-7 text-xs"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      {/* Sticky bottom bar (mobile-friendly) */}
      {totalItems > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-3 shadow-lg">
          <div className="mx-auto max-w-4xl flex items-center gap-3">
            <Progress value={progressPct} className="flex-1" />
            <span className="text-sm font-medium whitespace-nowrap">
              {pickedCount}/{totalItems}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
