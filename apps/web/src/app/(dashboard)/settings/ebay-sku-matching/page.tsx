'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Loader2,
  Search,
  Trash2,
  Unlink,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

interface UnmatchedSku {
  sku: string;
  title: string;
  orderCount: number;
  totalQuantity: number;
}

interface SkuMapping {
  id: string;
  ebay_sku: string;
  inventory_item_id: string;
  created_at: string;
  inventory_item?: {
    id: string;
    sku: string;
    set_number: string | null;
    item_name: string | null;
    storage_location: string | null;
  };
}

interface InventoryItem {
  id: string;
  sku: string | null;
  set_number: string | null;
  item_name: string | null;
  storage_location: string | null;
  status: string;
}

// API Functions
async function fetchUnmatchedSkus(): Promise<{ data: UnmatchedSku[]; total: number }> {
  const response = await fetch('/api/ebay/unmatched-skus');
  if (!response.ok) throw new Error('Failed to fetch unmatched SKUs');
  return response.json();
}

async function fetchSkuMappings(): Promise<{ data: SkuMapping[] }> {
  const response = await fetch('/api/ebay/sku-mapping');
  if (!response.ok) throw new Error('Failed to fetch SKU mappings');
  return response.json();
}

async function searchInventory(query: string): Promise<{ data: InventoryItem[] }> {
  const response = await fetch(`/api/inventory?search=${encodeURIComponent(query)}&pageSize=20&status=Available`);
  if (!response.ok) throw new Error('Failed to search inventory');
  return response.json();
}

async function createMapping(data: { ebaySku: string; inventoryItemId: string }): Promise<void> {
  const response = await fetch('/api/ebay/sku-mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create mapping');
  }
}

async function deleteMapping(id: string): Promise<void> {
  const response = await fetch(`/api/ebay/sku-mapping/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete mapping');
}

export default function EbaySkuMatchingPage() {
  const queryClient = useQueryClient();
  const [matchingDialogOpen, setMatchingDialogOpen] = useState(false);
  const [selectedSku, setSelectedSku] = useState<UnmatchedSku | null>(null);
  const [inventorySearch, setInventorySearch] = useState('');
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Queries
  const { data: unmatchedData, isLoading: loadingUnmatched } = useQuery({
    queryKey: ['ebay', 'unmatched-skus'],
    queryFn: fetchUnmatchedSkus,
  });

  const { data: mappingsData, isLoading: loadingMappings } = useQuery({
    queryKey: ['ebay', 'sku-mappings'],
    queryFn: fetchSkuMappings,
  });

  // Mutations
  const createMappingMutation = useMutation({
    mutationFn: createMapping,
    onSuccess: () => {
      setMessage({ type: 'success', text: 'SKU mapping created successfully' });
      setMatchingDialogOpen(false);
      setSelectedSku(null);
      setInventorySearch('');
      setSearchResults([]);
      queryClient.invalidateQueries({ queryKey: ['ebay', 'unmatched-skus'] });
      queryClient.invalidateQueries({ queryKey: ['ebay', 'sku-mappings'] });
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message });
    },
  });

  const deleteMappingMutation = useMutation({
    mutationFn: deleteMapping,
    onSuccess: () => {
      setMessage({ type: 'success', text: 'SKU mapping removed' });
      queryClient.invalidateQueries({ queryKey: ['ebay', 'unmatched-skus'] });
      queryClient.invalidateQueries({ queryKey: ['ebay', 'sku-mappings'] });
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message });
    },
  });

  const handleOpenMatching = (sku: UnmatchedSku) => {
    setSelectedSku(sku);
    setMatchingDialogOpen(true);
    setInventorySearch(sku.sku);
    handleSearch(sku.sku);
  };

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const result = await searchInventory(query);
      setSearchResults(result.data || []);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectInventoryItem = (item: InventoryItem) => {
    if (!selectedSku) return;
    createMappingMutation.mutate({
      ebaySku: selectedSku.sku,
      inventoryItemId: item.id,
    });
  };

  const handleDeleteMapping = (id: string) => {
    if (confirm('Are you sure you want to remove this SKU mapping?')) {
      deleteMappingMutation.mutate(id);
    }
  };

  const unmatchedSkus = unmatchedData?.data || [];
  const mappings = mappingsData?.data || [];

  return (
    <>
      <Header title="eBay SKU Matching" />
      <div className="p-6 space-y-6 max-w-6xl">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">eBay SKU Matching</h2>
          <p className="text-muted-foreground">
            Match eBay listing SKUs to your inventory items for accurate picking lists
          </p>
        </div>

        {message && (
          <Alert
            className={message.type === 'success' ? 'bg-green-50 border-green-200' : undefined}
            variant={message.type === 'error' ? 'destructive' : undefined}
          >
            {message.type === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
            <AlertDescription className={message.type === 'success' ? 'text-green-800' : undefined}>
              {message.text}
            </AlertDescription>
          </Alert>
        )}

        {/* Unmatched SKUs Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              <div>
                <CardTitle>Unmatched SKUs</CardTitle>
                <CardDescription>
                  These eBay SKUs don&apos;t match any inventory items. Create manual mappings to enable order fulfillment.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingUnmatched ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : unmatchedSkus.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-600" />
                <p className="font-medium">All SKUs are matched!</p>
                <p className="text-sm">No unmatched eBay SKUs found in unfulfilled orders.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>eBay SKU</TableHead>
                    <TableHead>Item Title</TableHead>
                    <TableHead className="text-center">Orders</TableHead>
                    <TableHead className="text-center">Total Qty</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unmatchedSkus.map((sku) => (
                    <TableRow key={sku.sku}>
                      <TableCell className="font-mono text-sm">{sku.sku}</TableCell>
                      <TableCell className="max-w-[300px] truncate">{sku.title}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{sku.orderCount}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{sku.totalQuantity}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          onClick={() => handleOpenMatching(sku)}
                        >
                          <Link2 className="h-4 w-4 mr-1" />
                          Match
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Existing Mappings Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Link2 className="h-5 w-5 text-blue-600" />
              <div>
                <CardTitle>Existing Mappings</CardTitle>
                <CardDescription>
                  Manually created SKU mappings between eBay and your inventory
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingMappings ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : mappings.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Unlink className="h-12 w-12 mx-auto mb-4" />
                <p className="font-medium">No mappings created yet</p>
                <p className="text-sm">Create mappings from the unmatched SKUs section above.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>eBay SKU</TableHead>
                    <TableHead>Inventory Item</TableHead>
                    <TableHead>Set Number</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((mapping) => (
                    <TableRow key={mapping.id}>
                      <TableCell className="font-mono text-sm">{mapping.ebay_sku}</TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {mapping.inventory_item?.item_name || mapping.inventory_item?.sku || '-'}
                      </TableCell>
                      <TableCell>{mapping.inventory_item?.set_number || '-'}</TableCell>
                      <TableCell>{mapping.inventory_item?.storage_location || '-'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(mapping.created_at).toLocaleDateString('en-GB')}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteMapping(mapping.id)}
                          disabled={deleteMappingMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Matching Dialog */}
        <Dialog open={matchingDialogOpen} onOpenChange={setMatchingDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Match eBay SKU to Inventory</DialogTitle>
              <DialogDescription>
                Search for an inventory item to match with eBay SKU: <strong className="font-mono">{selectedSku?.sku}</strong>
              </DialogDescription>
            </DialogHeader>

            {selectedSku && (
              <div className="space-y-4">
                <div className="bg-muted p-3 rounded-lg">
                  <p className="text-sm text-muted-foreground">eBay Item Title:</p>
                  <p className="font-medium">{selectedSku.title}</p>
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search inventory by SKU, set number, or name..."
                      value={inventorySearch}
                      onChange={(e) => setInventorySearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSearch(inventorySearch);
                        }
                      }}
                      className="pl-10"
                    />
                  </div>
                  <Button onClick={() => handleSearch(inventorySearch)} disabled={isSearching}>
                    {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
                  </Button>
                </div>

                <div className="border rounded-lg max-h-[300px] overflow-y-auto">
                  {isSearching ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="text-sm">No inventory items found. Try a different search.</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>SKU / Set</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead className="w-[80px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {searchResults.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>
                              <div className="font-mono text-sm">{item.sku || '-'}</div>
                              {item.set_number && (
                                <div className="text-xs text-muted-foreground">
                                  Set: {item.set_number}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate">
                              {item.item_name || '-'}
                            </TableCell>
                            <TableCell>{item.storage_location || '-'}</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                onClick={() => handleSelectInventoryItem(item)}
                                disabled={createMappingMutation.isPending}
                              >
                                {createMappingMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  'Select'
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setMatchingDialogOpen(false);
                      setSelectedSku(null);
                      setInventorySearch('');
                      setSearchResults([]);
                    }}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
