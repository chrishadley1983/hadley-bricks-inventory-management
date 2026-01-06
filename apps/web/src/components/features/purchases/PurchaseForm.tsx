'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useCreatePurchase, useUpdatePurchase } from '@/hooks';
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
import { MileageSection } from './MileageSection';
import type { Purchase } from '@hadley-bricks/database';

const purchaseSchema = z.object({
  purchase_date: z.string().min(1, 'Purchase date is required'),
  short_description: z.string().min(1, 'Description is required'),
  cost: z.string().min(1, 'Cost is required'),
  source: z.string().optional(),
  payment_method: z.string().optional(),
  description: z.string().optional(),
  reference: z.string().optional(),
});

type PurchaseFormValues = z.infer<typeof purchaseSchema>;

interface PurchaseFormProps {
  mode: 'create' | 'edit';
  initialData?: Purchase;
  onSuccess?: (purchase: Purchase) => void;
}

const SOURCES = [
  { value: 'eBay', label: 'eBay' },
  { value: 'FB Marketplace', label: 'FB Marketplace' },
  { value: 'BrickLink', label: 'BrickLink' },
  { value: 'Amazon', label: 'Amazon' },
  { value: 'Car Boot', label: 'Car Boot' },
  { value: 'Gumtree', label: 'Gumtree' },
  { value: 'Retail', label: 'Retail' },
  { value: 'Private', label: 'Private' },
  { value: 'Auction', label: 'Auction' },
  { value: 'Other', label: 'Other' },
];

const PAYMENT_METHODS = [
  { value: 'Cash', label: 'Cash' },
  { value: 'Card', label: 'Card' },
  { value: 'PayPal', label: 'PayPal' },
  { value: 'Bank Transfer', label: 'Bank Transfer' },
  { value: 'HSBC - Cash', label: 'HSBC - Cash' },
  { value: 'Monzo - Card', label: 'Monzo - Card' },
];

export function PurchaseForm({ mode, initialData, onSuccess }: PurchaseFormProps) {
  const router = useRouter();
  const createMutation = useCreatePurchase();
  const updateMutation = useUpdatePurchase();

  const today = new Date().toISOString().split('T')[0];

  const form = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: {
      purchase_date: initialData?.purchase_date || today,
      short_description: initialData?.short_description || '',
      cost: initialData?.cost?.toString() || '',
      source: initialData?.source || undefined,
      payment_method: initialData?.payment_method || undefined,
      description: initialData?.description || '',
      reference: initialData?.reference || '',
    },
  });

  const onSubmit = async (values: PurchaseFormValues) => {
    const costNum = parseFloat(values.cost);

    const purchaseData = {
      purchase_date: values.purchase_date,
      short_description: values.short_description,
      cost: isNaN(costNum) ? 0 : costNum,
      source: values.source || null,
      payment_method: values.payment_method || null,
      description: values.description || null,
      reference: values.reference || null,
    };

    let result: Purchase;
    if (mode === 'create') {
      result = await createMutation.mutateAsync(purchaseData);
    } else {
      result = await updateMutation.mutateAsync({
        id: initialData!.id,
        data: purchaseData,
      });
    }

    if (onSuccess) {
      onSuccess(result);
    } else {
      router.push(`/purchases/${result.id}`);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href={mode === 'edit' && initialData ? `/purchases/${initialData.id}` : '/purchases'}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {mode === 'create' ? 'Add Purchase' : 'Edit Purchase'}
            </h1>
            <p className="text-muted-foreground">
              {mode === 'create' ? 'Record a new purchase' : 'Update purchase details'}
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Purchase Details</CardTitle>
              <CardDescription>Essential purchase information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="purchase_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="short_description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Short Description *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., 3 Star Wars sets from eBay" {...field} />
                    </FormControl>
                    <FormDescription>
                      A brief description of what was purchased
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Cost (GBP) *</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="0.00" {...field} />
                    </FormControl>
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
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select source" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SOURCES.map((option) => (
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
                name="payment_method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Method</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select payment method" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAYMENT_METHODS.map((option) => (
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
            </CardContent>
          </Card>

          {/* Additional Information */}
          <Card>
            <CardHeader>
              <CardTitle>Additional Information</CardTitle>
              <CardDescription>Optional details about the purchase</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reference</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Order ID, Receipt number" {...field} />
                    </FormControl>
                    <FormDescription>
                      Optional reference number for tracking
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Any additional notes about this purchase..."
                        className="min-h-[150px]"
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

        {/* Mileage Section - only show in edit mode */}
        {mode === 'edit' && initialData && (
          <MileageSection
            purchaseId={initialData.id}
            purchaseDate={form.watch('purchase_date')}
          />
        )}

        {/* Form Actions */}
        <div className="flex justify-end gap-4">
          <Button variant="outline" type="button" asChild>
            <Link href={mode === 'edit' && initialData ? `/purchases/${initialData.id}` : '/purchases'}>
              Cancel
            </Link>
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Purchase' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
