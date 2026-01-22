'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Search, Loader2, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { Purchase } from '@hadley-bricks/database';
import { SELLING_PLATFORMS, PLATFORM_LABELS, type SellingPlatform } from '@hadley-bricks/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useCreateInventory, useUpdateInventory, useInventoryItem } from '@/hooks';
import { PurchaseLookup } from './PurchaseLookup';
import { QuickPurchaseDialog } from './QuickPurchaseDialog';
import { SetNumberLookup } from './SetNumberLookup';
import type { PurchaseSearchResult } from '@/lib/api';

const inventoryFormSchema = z.object({
  set_number: z.string().min(1, 'Set number is required'),
  item_name: z.string().optional(),
  condition: z.enum(['New', 'Used']).optional(),
  status: z.enum(['NOT YET RECEIVED', 'BACKLOG', 'LISTED', 'SOLD']).optional(),
  source: z.string().optional(),
  purchase_date: z.string().optional(),
  cost: z.string().optional(),
  purchase_id: z.string().optional(),
  listing_date: z.string().optional(),
  listing_value: z.string().optional(),
  storage_location: z.string().optional(),
  sku: z.string().optional(),
  linked_lot: z.string().optional(),
  amazon_asin: z.string().optional(),
  listing_platform: z.string().optional(),
  notes: z.string().optional(),
});

type InventoryFormValues = z.infer<typeof inventoryFormSchema>;

interface InventoryFormProps {
  mode: 'create' | 'edit';
  itemId?: string;
  showHeader?: boolean;
  /** Pre-select a purchase when adding from a purchase detail page */
  initialPurchaseId?: string | null;
}

const STATUS_OPTIONS = [
  { value: 'NOT YET RECEIVED', label: 'Not Yet Received' },
  { value: 'BACKLOG', label: 'Backlog' },
  { value: 'LISTED', label: 'Listed' },
  { value: 'SOLD', label: 'Sold' },
];

const CONDITION_OPTIONS = [
  { value: 'New', label: 'New' },
  { value: 'Used', label: 'Used' },
];

/**
 * Normalize condition value from database to form enum
 */
function normalizeCondition(value: string | null | undefined): 'New' | 'Used' | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === 'new') return 'New';
  if (lower === 'used') return 'Used';
  return undefined;
}

/**
 * Normalize status value from database to form enum
 */
function normalizeStatus(value: string | null | undefined): InventoryFormValues['status'] | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase().replace(/\s+/g, ' ').trim();
  if (upper === 'NOT YET RECEIVED') return 'NOT YET RECEIVED';
  if (upper === 'BACKLOG') return 'BACKLOG';
  if (upper === 'LISTED') return 'LISTED';
  if (upper === 'SOLD') return 'SOLD';
  return undefined;
}

export function InventoryForm({ mode, itemId, showHeader = true, initialPurchaseId }: InventoryFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const createMutation = useCreateInventory();
  const updateMutation = useUpdateInventory();
  const { data: existingItem, isLoading: isLoadingItem } = useInventoryItem(
    mode === 'edit' ? itemId : undefined
  );

  // State for purchase lookup
  const [selectedPurchase, setSelectedPurchase] = React.useState<PurchaseSearchResult | null>(null);
  const [quickPurchaseOpen, setQuickPurchaseOpen] = React.useState(false);
  const [quickPurchaseDefaultDesc, setQuickPurchaseDefaultDesc] = React.useState('');

  // State for field lookups
  const [isLookingUpAsin, setIsLookingUpAsin] = React.useState(false);
  const [selectedSetEan, setSelectedSetEan] = React.useState<string | null>(null);

  const form = useForm<InventoryFormValues>({
    resolver: zodResolver(inventoryFormSchema),
    defaultValues: {
      set_number: '',
      item_name: '',
      condition: undefined,
      status: 'NOT YET RECEIVED',
      source: '',
      purchase_date: '',
      cost: '',
      purchase_id: '',
      listing_date: '',
      listing_value: '',
      storage_location: '',
      sku: '',
      linked_lot: '',
      amazon_asin: '',
      listing_platform: '',
      notes: '',
    },
  });

  // Reset form when existing item data loads
  const { reset } = form;
  React.useEffect(() => {
    if (existingItem && mode === 'edit') {
      const normalizedCondition = normalizeCondition(existingItem.condition);
      const normalizedStatus = normalizeStatus(existingItem.status);
      reset({
        set_number: existingItem.set_number,
        item_name: existingItem.item_name || '',
        condition: normalizedCondition,
        status: normalizedStatus || 'NOT YET RECEIVED',
        source: existingItem.source || '',
        purchase_date: existingItem.purchase_date || '',
        cost: existingItem.cost?.toString() || '',
        purchase_id: existingItem.purchase_id || '',
        listing_date: existingItem.listing_date || '',
        listing_value: existingItem.listing_value?.toString() || '',
        storage_location: existingItem.storage_location || '',
        sku: existingItem.sku || '',
        linked_lot: existingItem.linked_lot || '',
        amazon_asin: existingItem.amazon_asin || '',
        listing_platform: existingItem.listing_platform || '',
        notes: existingItem.notes || '',
      });
    }
  }, [existingItem, mode, reset]);

  // Load linked purchase details when editing an item with a purchase_id
  React.useEffect(() => {
    async function loadLinkedPurchase() {
      if (existingItem?.purchase_id && mode === 'edit') {
        try {
          const response = await fetch(`/api/purchases/${existingItem.purchase_id}`);
          if (response.ok) {
            const result = await response.json();
            if (result.data) {
              // Transform purchase data to PurchaseSearchResult format
              const purchaseResult: PurchaseSearchResult = {
                id: result.data.id,
                short_description: result.data.short_description,
                purchase_date: result.data.purchase_date,
                cost: result.data.cost,
                source: result.data.source,
                reference: result.data.reference,
                items_linked: result.data.items_linked ?? 0,
              };
              setSelectedPurchase(purchaseResult);
            }
          }
        } catch (error) {
          console.error('Failed to load linked purchase:', error);
        }
      }
    }
    loadLinkedPurchase();
  }, [existingItem?.purchase_id, mode]);

  // Load initial purchase when creating from a purchase detail page
  React.useEffect(() => {
    async function loadInitialPurchase() {
      if (initialPurchaseId && mode === 'create') {
        try {
          const response = await fetch(`/api/purchases/${initialPurchaseId}`);
          if (response.ok) {
            const result = await response.json();
            if (result.data) {
              // Transform purchase data to PurchaseSearchResult format
              const purchaseResult: PurchaseSearchResult = {
                id: result.data.id,
                short_description: result.data.short_description,
                purchase_date: result.data.purchase_date,
                cost: result.data.cost,
                source: result.data.source,
                reference: result.data.reference,
                items_linked: result.data.items_linked ?? 0,
              };
              // Set the selected purchase and auto-fill form fields
              setSelectedPurchase(purchaseResult);
              form.setValue('purchase_id', purchaseResult.id);
              form.setValue('purchase_date', purchaseResult.purchase_date);
              if (purchaseResult.source) {
                form.setValue('source', purchaseResult.source);
              }
            }
          }
        } catch (error) {
          console.error('Failed to load initial purchase:', error);
        }
      }
    }
    loadInitialPurchase();
  }, [initialPurchaseId, mode, form]);

  // Handle purchase selection from lookup
  const handlePurchaseSelect = React.useCallback(
    (purchase: PurchaseSearchResult | null, suggestedCost: number | null) => {
      setSelectedPurchase(purchase);
      if (purchase) {
        form.setValue('purchase_id', purchase.id);
        form.setValue('purchase_date', purchase.purchase_date);
        if (purchase.source) {
          form.setValue('source', purchase.source);
        }
        if (suggestedCost !== null) {
          form.setValue('cost', suggestedCost.toFixed(2));
        }
      } else {
        form.setValue('purchase_id', '');
      }
    },
    [form]
  );

  // Handle creating a new purchase from the lookup
  const handleCreateNewPurchase = React.useCallback((searchTerm: string) => {
    setQuickPurchaseDefaultDesc(searchTerm);
    setQuickPurchaseOpen(true);
  }, []);

  // Handle new purchase created from dialog
  const handlePurchaseCreated = React.useCallback(
    (purchase: Purchase) => {
      // Convert to search result format
      const searchResult: PurchaseSearchResult = {
        id: purchase.id,
        short_description: purchase.short_description,
        purchase_date: purchase.purchase_date,
        cost: purchase.cost,
        source: purchase.source,
        reference: purchase.reference,
        items_linked: 0,
      };
      handlePurchaseSelect(searchResult, purchase.cost);
    },
    [handlePurchaseSelect]
  );

  // Handle set selection from SetNumberLookup
  const handleSetSelected = React.useCallback(
    (set: { setNumber: string; setName: string; ean?: string }) => {
      // Save only the base set number (without variant suffix like "-1")
      const baseSetNumber = set.setNumber.split('-')[0];
      form.setValue('set_number', baseSetNumber);
      form.setValue('item_name', set.setName);
      setSelectedSetEan(set.ean || null);
      // Clear ASIN when set changes (user can look up new one)
      form.setValue('amazon_asin', '');
      toast({
        title: 'Set selected',
        description: `${set.setNumber} - ${set.setName}`,
      });
    },
    [form, toast]
  );

  // Look up ASIN from inventory or Amazon
  const handleLookupAsin = React.useCallback(async () => {
    const setNumber = form.getValues('set_number');
    const setName = form.getValues('item_name');

    if (!setNumber) {
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
      let url = `/api/inventory/lookup-asin?setNumber=${encodeURIComponent(setNumber)}`;
      if (selectedSetEan) {
        url += `&ean=${encodeURIComponent(selectedSetEan)}`;
      }

      const response = await fetch(url);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Lookup failed');
      }

      if (result.data?.asin) {
        form.setValue('amazon_asin', result.data.asin);
        const sourceLabel = result.data.source === 'inventory' ? 'existing inventory' : 'Amazon catalog';
        toast({
          title: 'ASIN found',
          description: `Found ${result.data.asin} from ${sourceLabel}`,
        });
      } else {
        toast({
          title: 'ASIN not found',
          description: result.message || `No ASIN found for set ${setNumber}${setName ? ` (${setName})` : ''}`,
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
  }, [form, toast, selectedSetEan]);

  const onSubmit = async (values: InventoryFormValues) => {
    const costNum = values.cost ? parseFloat(values.cost) : undefined;
    const listingValueNum = values.listing_value ? parseFloat(values.listing_value) : undefined;

    const data = {
      ...values,
      cost: costNum && !isNaN(costNum) ? costNum : undefined,
      listing_value: listingValueNum && !isNaN(listingValueNum) ? listingValueNum : undefined,
      purchase_id: values.purchase_id || undefined,
    };

    if (mode === 'edit' && itemId) {
      await updateMutation.mutateAsync({ id: itemId, data });
      router.push(`/inventory/${itemId}`);
    } else {
      const result = await createMutation.mutateAsync(data);
      router.push(`/inventory/${result.id}`);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  if (mode === 'edit' && isLoadingItem) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Header - conditionally shown */}
        {showHeader && (
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href={mode === 'edit' && itemId ? `/inventory/${itemId}` : '/inventory'}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold">
                {mode === 'create' ? 'Add Inventory Item' : 'Edit Inventory Item'}
              </h1>
              <p className="text-muted-foreground">
                {mode === 'create' ? 'Add a new item to your inventory' : 'Update item details'}
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>Essential details about the item</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="set_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Set Number *</FormLabel>
                    <FormControl>
                      <SetNumberLookup
                        value={field.value}
                        onChange={field.onChange}
                        onSetSelected={handleSetSelected}
                        placeholder="e.g., 75192"
                      />
                    </FormControl>
                    <FormDescription>
                      Type to search Brickset for set details
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="item_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Millennium Falcon" {...field} />
                    </FormControl>
                    <FormDescription>
                      Auto-filled when you select a set above
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="condition"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Condition</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || undefined}
                      key={`condition-${field.value || 'empty'}`}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select condition" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CONDITION_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || undefined}
                      key={`status-${field.value || 'empty'}`}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="source"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., LEGO Store, eBay" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Financial Details */}
          <Card>
            <CardHeader>
              <CardTitle>Financial Details</CardTitle>
              <CardDescription>Cost and pricing information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase Cost (GBP)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="purchase_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="listing_value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Listing Value (GBP)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="listing_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Listing Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="listing_platform"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Listing Platform</FormLabel>
                    <Select
                      value={field.value || undefined}
                      onValueChange={(val: string) => field.onChange(val || '')}
                      key={`listing_platform-${field.value || 'empty'}`}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select platform..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SELLING_PLATFORMS.map((platform) => (
                          <SelectItem key={platform} value={platform}>
                            {PLATFORM_LABELS[platform as SellingPlatform]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Storage & Identifiers */}
          <Card>
            <CardHeader>
              <CardTitle>Storage & Identifiers</CardTitle>
              <CardDescription>Location and tracking information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="storage_location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Storage Location</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Shelf A3" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sku"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SKU</FormLabel>
                    <FormControl>
                      <Input placeholder="Auto-generated if empty" {...field} />
                    </FormControl>
                    <FormDescription>Leave empty to auto-generate</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="purchase_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Linked Purchase</FormLabel>
                    <FormControl>
                      <PurchaseLookup
                        value={field.value}
                        selectedPurchase={selectedPurchase}
                        onSelect={handlePurchaseSelect}
                        onCreateNew={handleCreateNewPurchase}
                      />
                    </FormControl>
                    <FormDescription>
                      Link to a purchase to auto-fill cost and date
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="amazon_asin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amazon ASIN</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input placeholder="e.g., B07BMGGZY5" {...field} />
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleLookupAsin}
                        disabled={isLookingUpAsin}
                        title="Look up ASIN from inventory or Amazon"
                      >
                        {isLookingUpAsin ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="h-4 w-4" />
                        )}
                      </Button>
                      {field.value && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          asChild
                          title="View on Amazon"
                        >
                          <a
                            href={`https://www.amazon.co.uk/dp/${field.value}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                    </div>
                    <FormDescription>
                      Click search to find ASIN from inventory or Amazon
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
              <CardDescription>Additional information</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        placeholder="Any additional notes about this item..."
                        className="min-h-[120px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        </div>

        {/* Form Actions */}
        <div className="flex justify-end gap-4">
          <Button variant="outline" type="button" asChild>
            <Link href={mode === 'edit' && itemId ? `/inventory/${itemId}` : '/inventory'}>
              Cancel
            </Link>
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Item' : 'Save Changes'}
          </Button>
        </div>
      </form>

      {/* Quick Purchase Dialog */}
      <QuickPurchaseDialog
        open={quickPurchaseOpen}
        onOpenChange={setQuickPurchaseOpen}
        onPurchaseCreated={handlePurchaseCreated}
        defaultDescription={quickPurchaseDefaultDesc}
      />
    </Form>
  );
}
