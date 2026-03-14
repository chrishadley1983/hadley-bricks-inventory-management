'use client';

import { useState } from 'react';
import {
  useAllPromotedAds,
  usePromotedCampaigns,
  useUpdateAdsBid,
  useRemovePromotedAds,
  useAddPromotedAds,
} from '@/hooks/use-promoted-listings';
import { useToast } from '@/hooks/use-toast';
import type { EbayAd, EbayCampaign } from '@/lib/ebay/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, RefreshCw, TrendingUp, Trash2, Plus } from 'lucide-react';

interface FlatAd extends EbayAd {
  campaignName: string;
}

export function PromotedAdsView() {
  const { toast } = useToast();
  const { data: campaignAds, isLoading, refetch, isRefetching } = useAllPromotedAds();
  const { data: campaigns } = usePromotedCampaigns();
  const updateBid = useUpdateAdsBid();
  const removeAds = useRemovePromotedAds();
  const addAds = useAddPromotedAds();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newBidPercentage, setNewBidPercentage] = useState('5.0');
  const [addListingIds, setAddListingIds] = useState('');
  const [addCampaignId, setAddCampaignId] = useState('');
  const [addBidPercentage, setAddBidPercentage] = useState('5.0');

  // Flatten ads across campaigns
  const allAds: FlatAd[] = (campaignAds || []).flatMap(
    ({ campaign, ads }: { campaign: EbayCampaign; ads: EbayAd[] }) =>
      ads.map((ad) => ({ ...ad, campaignName: campaign.campaignName }))
  );

  const selectedAds = allAds.filter((ad) => selectedIds.has(ad.adId));
  const allSelected = allAds.length > 0 && selectedIds.size === allAds.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allAds.map((ad) => ad.adId)));
    }
  };

  const toggleOne = (adId: string) => {
    const next = new Set(selectedIds);
    if (next.has(adId)) {
      next.delete(adId);
    } else {
      next.add(adId);
    }
    setSelectedIds(next);
  };

  const handleUpdateBid = async () => {
    if (selectedAds.length === 0) return;

    // Group by campaign
    const byCampaign = new Map<string, Array<{ listingId: string; bidPercentage: string }>>();
    for (const ad of selectedAds) {
      const existing = byCampaign.get(ad.campaignId) || [];
      existing.push({ listingId: ad.listingId, bidPercentage: newBidPercentage });
      byCampaign.set(ad.campaignId, existing);
    }

    try {
      for (const [campaignId, listings] of byCampaign) {
        await updateBid.mutateAsync({ campaignId, listings });
      }
      toast({ title: 'Bid percentages updated', description: `Updated ${selectedAds.length} ads.` });
      setShowUpdateDialog(false);
      setSelectedIds(new Set());
    } catch (error) {
      toast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Failed to update bid percentages',
        variant: 'destructive',
      });
    }
  };

  const handleRemove = async () => {
    if (selectedAds.length === 0) return;

    const byCampaign = new Map<string, string[]>();
    for (const ad of selectedAds) {
      const existing = byCampaign.get(ad.campaignId) || [];
      existing.push(ad.listingId);
      byCampaign.set(ad.campaignId, existing);
    }

    try {
      for (const [campaignId, listingIds] of byCampaign) {
        await removeAds.mutateAsync({ campaignId, listingIds });
      }
      toast({ title: 'Ads removed', description: `Removed ${selectedAds.length} promoted listings.` });
      setShowRemoveDialog(false);
      setSelectedIds(new Set());
    } catch (error) {
      toast({
        title: 'Remove failed',
        description: error instanceof Error ? error.message : 'Failed to remove ads',
        variant: 'destructive',
      });
    }
  };

  const handleAdd = async () => {
    if (!addCampaignId || !addListingIds.trim()) return;

    const listingIds = addListingIds
      .split(/[,\n]/)
      .map((id) => id.trim())
      .filter(Boolean);

    try {
      const result = await addAds.mutateAsync({
        campaignId: addCampaignId,
        listings: listingIds.map((id) => ({ listingId: id, bidPercentage: addBidPercentage })),
      });
      toast({
        title: 'Ads added',
        description: `${result.successful.length} added, ${result.failed.length} failed.`,
      });
      setShowAddDialog(false);
      setAddListingIds('');
    } catch (error) {
      toast({
        title: 'Add failed',
        description: error instanceof Error ? error.message : 'Failed to add ads',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading promoted listings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Campaigns</CardDescription>
            <CardTitle className="text-2xl">{campaignAds?.length || 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Promoted Ads</CardDescription>
            <CardTitle className="text-2xl">{allAds.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Bid %</CardDescription>
            <CardTitle className="text-2xl">
              {allAds.length > 0
                ? (
                    allAds.reduce((sum, ad) => sum + parseFloat(ad.bidPercentage), 0) / allAds.length
                  ).toFixed(1) + '%'
                : '—'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Actions bar */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={`h-4 w-4 mr-1 ${isRefetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Listings
        </Button>
        {selectedIds.size > 0 && (
          <>
            <Button size="sm" onClick={() => setShowUpdateDialog(true)}>
              <TrendingUp className="h-4 w-4 mr-1" />
              Update Bid ({selectedIds.size})
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setShowRemoveDialog(true)}>
              <Trash2 className="h-4 w-4 mr-1" />
              Remove ({selectedIds.size})
            </Button>
          </>
        )}
      </div>

      {/* Ads table */}
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
              </TableHead>
              <TableHead>Listing ID</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Bid %</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allAds.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No promoted listings found. Add listings to a campaign to get started.
                </TableCell>
              </TableRow>
            ) : (
              allAds.map((ad) => (
                <TableRow key={ad.adId}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(ad.adId)}
                      onCheckedChange={() => toggleOne(ad.adId)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{ad.listingId}</TableCell>
                  <TableCell>{ad.campaignName}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ad.bidPercentage}%</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={ad.adStatus === 'ACTIVE' ? 'default' : 'outline'}>
                      {ad.adStatus}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Update Bid Dialog */}
      <Dialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Bid Percentage</DialogTitle>
            <DialogDescription>
              Set a new bid percentage for {selectedIds.size} selected listing(s).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium">Bid Percentage</label>
            <div className="flex items-center gap-2 mt-1">
              <Input
                type="number"
                min="2.0"
                max="100.0"
                step="0.1"
                value={newBidPercentage}
                onChange={(e) => setNewBidPercentage(e.target.value)}
                className="w-32"
              />
              <span className="text-sm text-muted-foreground">% (2.0 – 100.0)</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpdateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateBid} disabled={updateBid.isPending}>
              {updateBid.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Confirmation Dialog */}
      <Dialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Promoted Listings</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {selectedIds.size} listing(s) from promotion? They
              will no longer appear as promoted on eBay.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRemoveDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemove} disabled={removeAds.isPending}>
              {removeAds.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Listings Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Listings to Campaign</DialogTitle>
            <DialogDescription>
              Add eBay listing IDs to a promoted listings campaign.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Campaign</label>
              <Select value={addCampaignId} onValueChange={setAddCampaignId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a campaign" />
                </SelectTrigger>
                <SelectContent>
                  {(campaigns || []).map((c) => (
                    <SelectItem key={c.campaignId} value={c.campaignId}>
                      {c.campaignName} ({c.campaignStatus})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Bid Percentage</label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  type="number"
                  min="2.0"
                  max="100.0"
                  step="0.1"
                  value={addBidPercentage}
                  onChange={(e) => setAddBidPercentage(e.target.value)}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Listing IDs</label>
              <textarea
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[100px]"
                placeholder="Enter listing IDs, one per line or comma-separated"
                value={addListingIds}
                onChange={(e) => setAddListingIds(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={addAds.isPending || !addCampaignId || !addListingIds.trim()}
            >
              {addAds.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Add to Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
