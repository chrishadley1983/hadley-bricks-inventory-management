'use client';

import { useState } from 'react';
import { Search, Link2, ExternalLink, Check, X } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useUnmappedAsins, useCreateMapping } from '@/hooks/use-arbitrage';
import { buildBricklinkSearchUrl } from '@/lib/arbitrage/bricklink-url';
import { useToast } from '@/hooks/use-toast';

interface UnmappedAsinsTableProps {
  onMappingComplete?: () => void;
}

export function UnmappedAsinsTable({ onMappingComplete }: UnmappedAsinsTableProps) {
  const [search, setSearch] = useState('');
  const [mappingAsin, setMappingAsin] = useState<{
    asin: string;
    name: string | null;
  } | null>(null);
  const [setNumber, setSetNumber] = useState('');
  const { toast } = useToast();

  const { data: unmappedResponse, isLoading } = useUnmappedAsins();
  const createMappingMutation = useCreateMapping();

  // Extract items array from response
  const unmapped = unmappedResponse?.items ?? [];

  const filteredItems = unmapped.filter((item) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      item.asin.toLowerCase().includes(searchLower) ||
      item.name?.toLowerCase().includes(searchLower)
    );
  });

  const handleOpenMapping = (asin: string, name: string | null) => {
    setMappingAsin({ asin, name });
    setSetNumber('');
  };

  const handleCloseMapping = () => {
    setMappingAsin(null);
    setSetNumber('');
  };

  const handleSubmitMapping = async () => {
    if (!mappingAsin || !setNumber.trim()) return;

    try {
      await createMappingMutation.mutateAsync({
        asin: mappingAsin.asin,
        bricklinkSetNumber: setNumber.trim(),
      });
      toast({ title: 'Mapping created successfully' });
      handleCloseMapping();
      onMappingComplete?.();
    } catch {
      toast({ title: 'Failed to create mapping', variant: 'destructive' });
    }
  };

  const handleSearchBricklink = (name: string | null) => {
    if (!name) return;
    const searchQuery = name
      .replace(/LEGO/gi, '')
      .replace(/\(.*?\)/g, '')
      .trim();
    window.open(buildBricklinkSearchUrl(searchQuery), '_blank');
  };

  if (isLoading) {
    return <UnmappedTableSkeleton />;
  }

  if (unmapped.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/20">
        <div className="text-4xl mb-4">🎯</div>
        <h3 className="text-lg font-semibold">All ASINs Mapped</h3>
        <p className="text-muted-foreground mt-1">
          Every tracked ASIN has been linked to a BrickLink set number
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with search */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm">
            {unmapped.length} unmapped
          </Badge>
          <span className="text-sm text-muted-foreground">
            ASINs that need manual BrickLink mapping
          </span>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search unmapped ASINs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Table */}
      <ScrollArea className="h-[400px] border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ASIN</TableHead>
              <TableHead>Product Name</TableHead>
              <TableHead>Extracted Set #</TableHead>
              <TableHead className="w-[180px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  No matches found for &quot;{search}&quot;
                </TableCell>
              </TableRow>
            ) : (
              filteredItems.map((item) => (
                <TableRow key={item.asin}>
                  <TableCell>
                    <Badge variant="outline" className="font-mono">
                      {item.asin}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    <span className="line-clamp-2 text-sm">{item.name ?? '—'}</span>
                  </TableCell>
                  <TableCell>
                    {item.detectedSetNumber ? (
                      <Badge variant="secondary" className="font-mono">
                        {item.detectedSetNumber}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">None detected</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSearchBricklink(item.name)}
                        disabled={!item.name}
                      >
                        <ExternalLink className="mr-1.5 h-3 w-3" />
                        Search BL
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleOpenMapping(item.asin, item.name)}
                      >
                        <Link2 className="mr-1.5 h-3 w-3" />
                        Map
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Mapping Dialog */}
      <Dialog open={!!mappingAsin} onOpenChange={(open: boolean) => !open && handleCloseMapping()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Map ASIN to BrickLink Set</DialogTitle>
            <DialogDescription>
              Enter the BrickLink set number for this Amazon product.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">ASIN</Label>
              <div className="font-mono text-sm bg-muted px-3 py-2 rounded">
                {mappingAsin?.asin}
              </div>
            </div>

            {mappingAsin?.name && (
              <div className="space-y-2">
                <Label className="text-muted-foreground">Product Name</Label>
                <div className="text-sm bg-muted px-3 py-2 rounded line-clamp-2">
                  {mappingAsin.name}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="setNumber">BrickLink Set Number</Label>
              <Input
                id="setNumber"
                placeholder="e.g., 75192-1 or 75192"
                value={setNumber}
                onChange={(e) => setSetNumber(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Enter the set number with or without the -1 suffix
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => handleSearchBricklink(mappingAsin?.name ?? null)}
              disabled={!mappingAsin?.name}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Search BrickLink for this product
            </Button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseMapping}>
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button
              onClick={handleSubmitMapping}
              disabled={!setNumber.trim() || createMappingMutation.isPending}
            >
              <Check className="mr-2 h-4 w-4" />
              {createMappingMutation.isPending ? 'Validating...' : 'Create Mapping'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UnmappedTableSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-10 w-64" />
      </div>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ASIN</TableHead>
              <TableHead>Product Name</TableHead>
              <TableHead>Extracted Set #</TableHead>
              <TableHead className="w-[180px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-6 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-64" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-6 w-20" />
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-8 w-16" />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
