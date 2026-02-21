'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useCreateBrickLinkUpload, useUpdateBrickLinkUpload } from '@/hooks/use-bricklink-uploads';
import type { BrickLinkUpload } from '@/lib/services/bricklink-upload.service';
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

const uploadSchema = z.object({
  upload_date: z.string().min(1, 'Upload date is required'),
  total_quantity: z.string().min(1, 'Quantity is required'),
  selling_price: z.string().min(1, 'Selling price is required'),
  cost: z.string().optional(),
  lots: z.string().optional(),
  source: z.string().optional(),
  condition: z.string().optional(),
  notes: z.string().optional(),
  reference: z.string().optional(),
});

type UploadFormValues = z.infer<typeof uploadSchema>;

interface BrickLinkUploadFormProps {
  mode: 'create' | 'edit';
  initialData?: BrickLinkUpload;
  onSuccess?: (upload: BrickLinkUpload) => void;
}

const SOURCES = [
  { value: 'Auction', label: 'Auction' },
  { value: 'FB Marketplace', label: 'FB Marketplace' },
  { value: 'Vinted', label: 'Vinted' },
  { value: 'Car Boot', label: 'Car Boot' },
  { value: 'eBay', label: 'eBay' },
  { value: 'Various', label: 'Various' },
  { value: 'Lego.com', label: 'Lego.com' },
  { value: 'BL', label: 'BrickLink' },
  { value: 'Other', label: 'Other' },
];

export function BrickLinkUploadForm({ mode, initialData, onSuccess }: BrickLinkUploadFormProps) {
  const router = useRouter();
  const createMutation = useCreateBrickLinkUpload();
  const updateMutation = useUpdateBrickLinkUpload();

  const today = new Date().toISOString().split('T')[0];

  const form = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      upload_date: initialData?.upload_date || today,
      total_quantity: initialData?.total_quantity?.toString() || '',
      selling_price: initialData?.selling_price?.toString() || '',
      cost: initialData?.cost?.toString() || '',
      lots: initialData?.lots?.toString() || '',
      source: initialData?.source || undefined,
      condition: initialData?.condition || undefined,
      notes: initialData?.notes || '',
      reference: initialData?.reference || '',
    },
  });

  const onSubmit = async (values: UploadFormValues) => {
    const totalQuantity = parseInt(values.total_quantity);
    const sellingPrice = parseFloat(values.selling_price);
    const cost = values.cost ? parseFloat(values.cost) : null;
    const lots = values.lots ? parseInt(values.lots) : null;

    const uploadData = {
      upload_date: values.upload_date,
      total_quantity: isNaN(totalQuantity) ? 0 : totalQuantity,
      selling_price: isNaN(sellingPrice) ? 0 : sellingPrice,
      cost: cost !== null && !isNaN(cost) ? cost : null,
      lots: lots !== null && !isNaN(lots) ? lots : null,
      source: values.source || null,
      condition: values.condition && values.condition.length > 0 ? values.condition : null,
      notes: values.notes || null,
      reference: values.reference || null,
    };

    let result: BrickLinkUpload;
    if (mode === 'create') {
      result = await createMutation.mutateAsync(uploadData);
    } else {
      result = await updateMutation.mutateAsync({
        id: initialData!.id,
        data: uploadData,
      });
    }

    if (onSuccess) {
      onSuccess(result);
    } else {
      router.push(`/bricklink-uploads/${result.id}`);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // Calculate profit margin for display (as % of selling price)
  const sellingPrice = parseFloat(form.watch('selling_price') || '0');
  const cost = parseFloat(form.watch('cost') || '0');
  const profit = sellingPrice - cost;
  const profitMargin = sellingPrice > 0 ? ((profit / sellingPrice) * 100).toFixed(1) : '0';

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link
              href={
                mode === 'edit' && initialData
                  ? `/bricklink-uploads/${initialData.id}`
                  : '/bricklink-uploads'
              }
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {mode === 'create' ? 'Add Upload' : 'Edit Upload'}
            </h1>
            <p className="text-muted-foreground">
              {mode === 'create' ? 'Record a new BrickLink upload' : 'Update upload details'}
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Upload Details</CardTitle>
              <CardDescription>Core upload information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="upload_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Upload Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormDescription>When the batch was uploaded to stores</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="total_quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Parts *</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0" {...field} />
                      </FormControl>
                      <FormDescription>Total item count</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="lots"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lots</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0" {...field} />
                      </FormControl>
                      <FormDescription>Unique lot count</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="condition"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Condition</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value || ''}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select condition" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="N">New</SelectItem>
                        <SelectItem value="U">Used</SelectItem>
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
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select source" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SOURCES.map((source) => (
                          <SelectItem key={source.value} value={source.value}>
                            {source.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Where the items came from</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Financial Information */}
          <Card>
            <CardHeader>
              <CardTitle>Financial Details</CardTitle>
              <CardDescription>Pricing and cost information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="selling_price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Selling Price (Value) *</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormDescription>Total listing value</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormDescription>Purchase cost of items</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Margin display */}
              {cost > 0 && (
                <div className="rounded-lg border bg-muted/50 p-3">
                  <div className="text-sm text-muted-foreground">Calculated Margin</div>
                  <div
                    className={`text-lg font-semibold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {profit >= 0 ? '+' : ''}
                    {profit.toFixed(2)} ({profitMargin}%)
                  </div>
                </div>
              )}

              <FormField
                control={form.control}
                name="reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reference</FormLabel>
                    <FormControl>
                      <Input placeholder="Batch reference or ID" {...field} />
                    </FormControl>
                    <FormDescription>Optional reference code</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Any additional notes..."
                        className="min-h-[100px]"
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
            <Link
              href={
                mode === 'edit' && initialData
                  ? `/bricklink-uploads/${initialData.id}`
                  : '/bricklink-uploads'
              }
            >
              Cancel
            </Link>
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Upload' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
