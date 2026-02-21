'use client';

import { useState, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { AlertTriangle, Package, ExternalLink, Info, Search, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SetNumberLookup } from '@/components/features/inventory/SetNumberLookup';
import { formatCurrency } from '@/lib/utils';
import { calculateAmazonFBMProfit, formatCurrencyGBP } from '@/lib/arbitrage/calculations';
import { useToast } from '@/hooks/use-toast';

interface BricksetSet {
  setNumber: string;
  setName: string;
  theme: string;
  subtheme?: string;
  yearFrom: number;
  pieces?: number;
  imageUrl?: string;
}

export interface InventoryItemReviewData {
  purchaseIndex: number;
  purchaseTitle: string;
  purchaseCost: number;
  purchaseDate: string | null;
  vintedStatus: string;
  setNumber: string;
  itemName: string;
  condition: 'New' | 'Used';
  status: string;
  storageLocation: string;
  listingValue: number | null;
  amazonAsin: string;
  skipCreation: boolean;
  // Brickset data
  theme?: string;
  pieces?: number;
  imageUrl?: string;
  ean?: string;
}

interface VintedInventoryReviewCardProps {
  item: InventoryItemReviewData;
  onChange: (item: InventoryItemReviewData) => void;
}

/**
 * Card component for reviewing/editing inventory item details before import
 */
export function VintedInventoryReviewCard({ item, onChange }: VintedInventoryReviewCardProps) {
  const { toast } = useToast();
  const [setNumberInput, setSetNumberInput] = useState(item.setNumber);
  const [isLookingUpAsin, setIsLookingUpAsin] = useState(false);

  const handleSetNumberChange = useCallback(
    (value: string) => {
      setSetNumberInput(value);
      onChange({
        ...item,
        setNumber: value,
      });
    },
    [item, onChange]
  );

  const handleSetSelected = useCallback(
    (set: BricksetSet) => {
      onChange({
        ...item,
        setNumber: set.setNumber,
        itemName: set.setName,
        theme: set.theme,
        pieces: set.pieces,
        imageUrl: set.imageUrl,
      });
      setSetNumberInput(set.setNumber);
    },
    [item, onChange]
  );

  const handleItemNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({
        ...item,
        itemName: e.target.value,
      });
    },
    [item, onChange]
  );

  const handleConditionChange = useCallback(
    (value: string) => {
      onChange({
        ...item,
        condition: value as 'New' | 'Used',
      });
    },
    [item, onChange]
  );

  const handleStatusChange = useCallback(
    (value: string) => {
      onChange({
        ...item,
        status: value,
      });
    },
    [item, onChange]
  );

  const handleStorageLocationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({
        ...item,
        storageLocation: e.target.value,
      });
    },
    [item, onChange]
  );

  const handleSkipChange = useCallback(
    (checked: boolean) => {
      onChange({
        ...item,
        skipCreation: checked,
      });
    },
    [item, onChange]
  );

  const handleListingValueChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      const numValue = value === '' ? null : parseFloat(value);
      onChange({
        ...item,
        listingValue: numValue !== null && !isNaN(numValue) ? numValue : null,
      });
    },
    [item, onChange]
  );

  const handleAsinChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({
        ...item,
        amazonAsin: e.target.value,
      });
    },
    [item, onChange]
  );

  const handleLookupAsin = useCallback(async () => {
    if (!item.setNumber) {
      toast({
        title: 'Set number required',
        description: 'Please enter a set number first',
        variant: 'destructive',
      });
      return;
    }

    setIsLookingUpAsin(true);

    try {
      // Build URL with optional EAN parameter
      let url = `/api/inventory/lookup-asin?setNumber=${encodeURIComponent(item.setNumber)}`;
      if (item.ean) {
        url += `&ean=${encodeURIComponent(item.ean)}`;
      }

      const response = await fetch(url);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Lookup failed');
      }

      if (result.data?.asin) {
        onChange({
          ...item,
          amazonAsin: result.data.asin,
        });
        const sourceLabel =
          result.data.source === 'inventory' ? 'existing inventory' : 'Amazon catalog';
        toast({
          title: 'ASIN found',
          description: `Found ${result.data.asin} from ${sourceLabel}`,
        });
      } else {
        toast({
          title: 'ASIN not found',
          description: result.message || `No ASIN found for set ${item.setNumber}`,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Lookup failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsLookingUpAsin(false);
    }
  }, [item, onChange, toast]);

  const needsSetNumber = !item.setNumber && !item.skipCreation;

  // Calculate Amazon profit if listing value is set
  const profitBreakdown = useMemo(() => {
    if (!item.listingValue || item.listingValue <= 0) return null;
    return calculateAmazonFBMProfit(item.listingValue, item.purchaseCost);
  }, [item.listingValue, item.purchaseCost]);

  // SellerAmp URL - use ASIN if available, otherwise set number
  const sellerAmpSearchTerm = item.amazonAsin || item.setNumber;
  const sellerAmpUrl = sellerAmpSearchTerm
    ? `https://sas.selleramp.com/sas/lookup?SasLookup%5Bsearch_term%5D=${encodeURIComponent(sellerAmpSearchTerm)}`
    : null;

  return (
    <Card className={item.skipCreation ? 'opacity-60' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            <span className="truncate">{item.purchaseTitle}</span>
          </CardTitle>
          <span className="font-semibold text-primary">{formatCurrency(item.purchaseCost)}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Skip checkbox */}
        <div className="flex items-center gap-2">
          <Checkbox
            id={`skip-${item.purchaseIndex}`}
            checked={item.skipCreation}
            onCheckedChange={handleSkipChange}
          />
          <Label
            htmlFor={`skip-${item.purchaseIndex}`}
            className="text-sm font-normal cursor-pointer"
          >
            Skip inventory item creation (purchase will still be created)
          </Label>
        </div>

        {!item.skipCreation && (
          <>
            {/* Set Number with lookup */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Set Number *</Label>
                <SetNumberLookup
                  value={setNumberInput}
                  onChange={handleSetNumberChange}
                  onSetSelected={handleSetSelected}
                  placeholder="Search for set..."
                />
                {needsSetNumber && (
                  <p className="text-xs text-yellow-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Required - search for set number
                  </p>
                )}
              </div>

              {/* Item Name */}
              <div className="space-y-2">
                <Label>Item Name</Label>
                <Input
                  value={item.itemName}
                  onChange={handleItemNameChange}
                  placeholder="Select from dropdown to auto-fill"
                />
                {!item.itemName && (
                  <p className="text-xs text-muted-foreground">
                    Click a result from set search to auto-fill
                  </p>
                )}
              </div>
            </div>

            {/* Condition, Status, Storage Location, and Listing Value */}
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-2">
                <Label>Condition</Label>
                <Select value={item.condition} onValueChange={handleConditionChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="New">New</SelectItem>
                    <SelectItem value="Used">Used</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={item.status} onValueChange={handleStatusChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NOT YET RECEIVED">Not Yet Received</SelectItem>
                    <SelectItem value="BACKLOG">Backlog</SelectItem>
                    <SelectItem value="LISTED">Listed</SelectItem>
                    <SelectItem value="SOLD">Sold</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Auto-set from: {item.vintedStatus}</p>
              </div>

              <div className="space-y-2">
                <Label>Storage Location</Label>
                <Input
                  value={item.storageLocation}
                  onChange={handleStorageLocationChange}
                  placeholder="e.g., Shelf A3"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label>List Price (£)</Label>
                  {profitBreakdown && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          className="max-w-xs p-3 bg-popover text-popover-foreground"
                        >
                          <div className="space-y-1 text-xs">
                            <div className="font-semibold mb-2">Amazon FBM Profit Breakdown</div>
                            <div className="flex justify-between">
                              <span>Sale Price:</span>
                              <span>{formatCurrencyGBP(profitBreakdown.salePrice)}</span>
                            </div>
                            <div className="flex justify-between text-muted-foreground">
                              <span>Referral Fee (15%):</span>
                              <span>-{formatCurrencyGBP(profitBreakdown.referralFee)}</span>
                            </div>
                            <div className="flex justify-between text-muted-foreground">
                              <span>DST (2%):</span>
                              <span>-{formatCurrencyGBP(profitBreakdown.digitalServicesTax)}</span>
                            </div>
                            <div className="flex justify-between text-muted-foreground">
                              <span>VAT on Fees (20%):</span>
                              <span>-{formatCurrencyGBP(profitBreakdown.vatOnFees)}</span>
                            </div>
                            <div className="flex justify-between text-muted-foreground">
                              <span>Shipping ({profitBreakdown.shippingTier}):</span>
                              <span>-{formatCurrencyGBP(profitBreakdown.shippingCost)}</span>
                            </div>
                            <div className="border-t my-1 pt-1 flex justify-between">
                              <span>Net Payout:</span>
                              <span>{formatCurrencyGBP(profitBreakdown.netPayout)}</span>
                            </div>
                            <div className="flex justify-between text-muted-foreground">
                              <span>Cost (Vinted):</span>
                              <span>-{formatCurrencyGBP(profitBreakdown.productCost)}</span>
                            </div>
                            <div
                              className={`border-t my-1 pt-1 flex justify-between font-semibold ${profitBreakdown.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}
                            >
                              <span>Profit:</span>
                              <span>{formatCurrencyGBP(profitBreakdown.totalProfit)}</span>
                            </div>
                            <div className="flex justify-between text-muted-foreground">
                              <span>ROI:</span>
                              <span>{profitBreakdown.roiPercent.toFixed(1)}%</span>
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.listingValue ?? ''}
                    onChange={handleListingValueChange}
                    placeholder="e.g., 29.99"
                    className="flex-1"
                  />
                  {sellerAmpUrl && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <a
                            href={sellerAmpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-orange-600 hover:text-orange-800"
                          >
                            <span className="text-[10px] font-bold">SAS</span>
                          </a>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Open in SellerAmp</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                {profitBreakdown && (
                  <p
                    className={`text-xs ${profitBreakdown.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}
                  >
                    Profit: {formatCurrencyGBP(profitBreakdown.totalProfit)} (
                    {profitBreakdown.roiPercent.toFixed(0)}% ROI)
                  </p>
                )}
              </div>
            </div>

            {/* Amazon ASIN */}
            <div className="space-y-2">
              <Label>Amazon ASIN</Label>
              <div className="flex gap-2">
                <Input
                  value={item.amazonAsin}
                  onChange={handleAsinChange}
                  placeholder="e.g., B07BMGGZY5"
                  className="flex-1 max-w-xs"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleLookupAsin}
                        disabled={isLookingUpAsin || !item.setNumber}
                      >
                        {isLookingUpAsin ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Look up ASIN from inventory or Amazon</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {item.amazonAsin && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="outline" size="icon" asChild>
                          <a
                            href={`https://www.amazon.co.uk/dp/${item.amazonAsin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>View on Amazon</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Click search to find ASIN from inventory or Amazon
              </p>
            </div>

            {/* Brickset preview if set selected */}
            {item.imageUrl && (
              <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
                <div className="relative w-16 h-16 shrink-0">
                  <Image
                    src={item.imageUrl}
                    alt={item.itemName}
                    fill
                    className="object-contain"
                    sizes="64px"
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{item.itemName}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.theme}
                    {item.pieces && ` - ${item.pieces} pieces`}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
