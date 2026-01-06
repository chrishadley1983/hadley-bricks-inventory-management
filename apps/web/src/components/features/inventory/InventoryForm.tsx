'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
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
import { useCreateInventory, useUpdateInventory, useInventoryItem } from '@/hooks';

const inventoryFormSchema = z.object({
  set_number: z.string().min(1, 'Set number is required'),
  item_name: z.string().optional(),
  condition: z.enum(['New', 'Used']).optional(),
  status: z.enum(['NOT YET RECEIVED', 'BACKLOG', 'LISTED', 'SOLD']).optional(),
  source: z.string().optional(),
  purchase_date: z.string().optional(),
  cost: z.string().optional(),
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

export function InventoryForm({ mode, itemId }: InventoryFormProps) {
  const router = useRouter();
  const createMutation = useCreateInventory();
  const updateMutation = useUpdateInventory();
  const { data: existingItem, isLoading: isLoadingItem } = useInventoryItem(
    mode === 'edit' ? itemId : undefined
  );

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
      listing_date: '',
      listing_value: '',
      storage_location: '',
      sku: '',
      linked_lot: '',
      amazon_asin: '',
      listing_platform: '',
      notes: '',
    },
    values: existingItem
      ? {
          set_number: existingItem.set_number,
          item_name: existingItem.item_name || '',
          condition: (existingItem.condition as 'New' | 'Used' | undefined) || undefined,
          status: (existingItem.status as InventoryFormValues['status']) || 'NOT YET RECEIVED',
          source: existingItem.source || '',
          purchase_date: existingItem.purchase_date || '',
          cost: existingItem.cost?.toString() || '',
          listing_date: existingItem.listing_date || '',
          listing_value: existingItem.listing_value?.toString() || '',
          storage_location: existingItem.storage_location || '',
          sku: existingItem.sku || '',
          linked_lot: existingItem.linked_lot || '',
          amazon_asin: existingItem.amazon_asin || '',
          listing_platform: existingItem.listing_platform || '',
          notes: existingItem.notes || '',
        }
      : undefined,
  });

  const onSubmit = async (values: InventoryFormValues) => {
    const costNum = values.cost ? parseFloat(values.cost) : undefined;
    const listingValueNum = values.listing_value ? parseFloat(values.listing_value) : undefined;

    const data = {
      ...values,
      cost: costNum && !isNaN(costNum) ? costNum : undefined,
      listing_value: listingValueNum && !isNaN(listingValueNum) ? listingValueNum : undefined,
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
        {/* Header */}
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
                      <Input placeholder="e.g., 75192" {...field} />
                    </FormControl>
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
                    <Select onValueChange={field.onChange} value={field.value}>
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
                    <Select onValueChange={field.onChange} value={field.value}>
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
                    <FormControl>
                      <Input placeholder="e.g., BrickLink, eBay" {...field} />
                    </FormControl>
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
                name="linked_lot"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Linked Lot</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., LOT-2024-001" {...field} />
                    </FormControl>
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
                    <FormControl>
                      <Input placeholder="e.g., B07BMGGZY5" {...field} />
                    </FormControl>
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
    </Form>
  );
}
