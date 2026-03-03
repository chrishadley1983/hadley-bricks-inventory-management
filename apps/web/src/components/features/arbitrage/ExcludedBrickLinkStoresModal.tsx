'use client';

import { useState } from 'react';
import { RotateCcw, Search, Store } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useExcludedBrickLinkStores, useRestoreBrickLinkStore } from '@/hooks/use-arbitrage';
import { useToast } from '@/hooks/use-toast';
import { REASON_LABELS } from '@/lib/arbitrage/bricklink-store-constants';

interface ExcludedBrickLinkStoresModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function ExcludedBrickLinkStoresModal({
  isOpen,
  onClose,
}: ExcludedBrickLinkStoresModalProps) {
  const [search, setSearch] = useState('');
  const [restoringStore, setRestoringStore] = useState<string | null>(null);
  const { data: excluded, isLoading } = useExcludedBrickLinkStores();
  const restoreMutation = useRestoreBrickLinkStore();
  const { toast } = useToast();

  const filteredStores = (excluded ?? []).filter((store) => {
    if (!search) return true;
    return store.storeName.toLowerCase().includes(search.toLowerCase());
  });

  const handleRestore = async (storeName: string) => {
    setRestoringStore(storeName);
    try {
      await restoreMutation.mutateAsync(storeName);
      toast({ title: `${storeName} restored` });
    } catch {
      toast({ title: 'Failed to restore store', variant: 'destructive' });
    } finally {
      setRestoringStore(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Excluded BrickLink Stores
          </DialogTitle>
          <DialogDescription>
            Stores excluded from deal finder results. Restore them to include in future searches.
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search stores..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Search excluded stores"
          />
        </div>

        {/* Table */}
        <ScrollArea className="flex-1 min-h-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : filteredStores.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Store className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">
                {search ? 'No matching stores' : 'No excluded stores'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Store Name</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Excluded</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStores.map((store) => (
                  <TableRow key={store.id}>
                    <TableCell className="font-medium">{store.storeName}</TableCell>
                    <TableCell>
                      {store.reason ? (
                        <Badge variant="secondary" className="text-xs">
                          {REASON_LABELS[store.reason] ?? store.reason}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(store.excludedAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRestore(store.storeName)}
                        disabled={restoringStore === store.storeName}
                        className="h-7 gap-1"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Restore
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>

        {/* Count */}
        {!isLoading && (excluded ?? []).length > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            {filteredStores.length} of {(excluded ?? []).length} excluded stores
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
