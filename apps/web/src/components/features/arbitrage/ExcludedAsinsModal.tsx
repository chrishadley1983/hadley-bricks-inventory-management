'use client';

import { useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
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
import { useExcludedAsins, useRestoreAsin } from '@/hooks/use-arbitrage';
import { useToast } from '@/hooks/use-toast';

interface ExcludedAsinsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExcludedAsinsModal({ isOpen, onClose }: ExcludedAsinsModalProps) {
  const [search, setSearch] = useState('');
  const { data: excluded, isLoading } = useExcludedAsins();
  const restoreMutation = useRestoreAsin();
  const { toast } = useToast();

  const filteredItems = (excluded ?? []).filter((item) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      item.asin.toLowerCase().includes(searchLower) ||
      item.name?.toLowerCase().includes(searchLower) ||
      item.bricklinkSetNumber?.toLowerCase().includes(searchLower)
    );
  });

  const handleRestore = async (asin: string) => {
    try {
      await restoreMutation.mutateAsync(asin);
      toast({ title: 'ASIN restored to tracking' });
    } catch {
      toast({ title: 'Failed to restore ASIN', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Excluded ASINs</DialogTitle>
          <DialogDescription>
            ASINs you have excluded from tracking. Restore them to include in future syncs.
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search excluded ASINs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Table */}
        <ScrollArea className="flex-1 min-h-0">
          {isLoading ? (
            <ExcludedTableSkeleton />
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-4xl mb-4">✅</div>
              <h3 className="text-lg font-semibold">
                {excluded?.length === 0 ? 'No excluded ASINs' : 'No matches found'}
              </h3>
              <p className="text-muted-foreground mt-1">
                {excluded?.length === 0
                  ? "You haven't excluded any ASINs yet"
                  : 'Try a different search term'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ASIN</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Set #</TableHead>
                  <TableHead>Excluded</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="w-[100px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <TableRow key={item.asin}>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">
                        {item.asin}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">{item.name ?? '—'}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {item.bricklinkSetNumber ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.excludedAt ? new Date(item.excludedAt).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate text-sm text-muted-foreground">
                      {item.exclusionReason ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRestore(item.asin)}
                        disabled={restoreMutation.isPending}
                      >
                        <RotateCcw className="mr-2 h-3 w-3" />
                        Restore
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>

        {/* Summary */}
        {!isLoading && excluded && excluded.length > 0 && (
          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">
              {filteredItems.length} of {excluded.length} excluded ASINs
            </span>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExcludedTableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ASIN</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Set #</TableHead>
          <TableHead>Excluded</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead className="w-[100px]">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 3 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell>
              <Skeleton className="h-6 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-40" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-20" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-32" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-8 w-20" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
