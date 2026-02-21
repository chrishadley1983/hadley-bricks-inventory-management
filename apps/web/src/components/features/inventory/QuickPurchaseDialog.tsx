'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Purchase } from '@hadley-bricks/database';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useCreatePurchase } from '@/hooks';

const quickPurchaseSchema = z.object({
  short_description: z.string().min(1, 'Description is required'),
  cost: z
    .string()
    .min(1, 'Cost is required')
    .refine(
      (val) => {
        const num = parseFloat(val);
        return !isNaN(num) && num > 0;
      },
      { message: 'Cost must be a positive number' }
    ),
  purchase_date: z.string().min(1, 'Purchase date is required'),
  source: z.string().optional(),
  payment_method: z.string().optional(),
});

type QuickPurchaseFormValues = z.infer<typeof quickPurchaseSchema>;

const SOURCE_OPTIONS = [
  'eBay',
  'FB Marketplace',
  'BrickLink',
  'Amazon',
  'Car Boot',
  'LEGO Store',
  'Gumtree',
  'Private',
  'Retail',
  'Other',
];

const PAYMENT_METHOD_OPTIONS = ['Cash', 'Card', 'PayPal', 'Bank Transfer'];

interface QuickPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPurchaseCreated: (purchase: Purchase) => void;
  defaultDescription?: string;
}

/**
 * Quick purchase creation dialog for inline creation from the inventory form
 */
export function QuickPurchaseDialog({
  open,
  onOpenChange,
  onPurchaseCreated,
  defaultDescription = '',
}: QuickPurchaseDialogProps) {
  const { toast } = useToast();
  const createPurchase = useCreatePurchase();

  const form = useForm<QuickPurchaseFormValues>({
    resolver: zodResolver(quickPurchaseSchema),
    defaultValues: {
      short_description: defaultDescription,
      cost: '',
      purchase_date: new Date().toISOString().split('T')[0],
      source: '',
      payment_method: '',
    },
  });

  // Reset form when dialog opens with new default description
  React.useEffect(() => {
    if (open) {
      form.reset({
        short_description: defaultDescription,
        cost: '',
        purchase_date: new Date().toISOString().split('T')[0],
        source: '',
        payment_method: '',
      });
    }
  }, [open, defaultDescription, form]);

  const onSubmit = async (values: QuickPurchaseFormValues) => {
    try {
      const purchase = await createPurchase.mutateAsync({
        short_description: values.short_description,
        cost: parseFloat(values.cost),
        purchase_date: values.purchase_date,
        source: values.source || undefined,
        payment_method: values.payment_method || undefined,
      });

      onPurchaseCreated(purchase);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create purchase:', error);
      toast({
        title: 'Error',
        description: 'Failed to create purchase. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Purchase</DialogTitle>
          <DialogDescription>
            Quickly add a purchase to link with this inventory item.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="short_description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., 3x UCS sets from eBay" {...field} autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Cost (GBP) *</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" placeholder="0.00" {...field} />
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
                    <FormLabel>Purchase Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
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
                        {SOURCE_OPTIONS.map((source) => (
                          <SelectItem key={source} value={source}>
                            {source}
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
                          <SelectValue placeholder="Select method" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAYMENT_METHOD_OPTIONS.map((method) => (
                          <SelectItem key={method} value={method}>
                            {method}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createPurchase.isPending}>
                {createPurchase.isPending ? 'Creating...' : 'Create Purchase'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
