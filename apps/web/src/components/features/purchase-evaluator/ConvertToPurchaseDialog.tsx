'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { ArrowLeft, ArrowRight, ShoppingCart } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useConvertEvaluation } from '@/hooks/use-purchase-evaluator';
import { InventoryItemsEditor } from './InventoryItemsEditor';
import type {
  PurchaseEvaluation,
  EvaluationItem,
  EditableInventoryItem,
  ConvertEvaluationRequest,
} from '@/lib/purchase-evaluator';

// Purchase form schema
const purchaseFormSchema = z.object({
  purchase_date: z.string().min(1, 'Purchase date is required'),
  short_description: z.string().min(1, 'Description is required'),
  cost: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
    message: 'Cost must be a positive number',
  }),
  source: z.string().optional(),
  payment_method: z.string().optional(),
  reference: z.string().optional(),
  description: z.string().optional(),
});

type PurchaseFormValues = z.infer<typeof purchaseFormSchema>;

const SOURCE_OPTIONS = [
  'eBay',
  'FB Marketplace',
  'BrickLink',
  'Amazon',
  'Car Boot',
  'Gumtree',
  'Retail',
  'Private',
  'Auction',
  'Other',
] as const;

const PAYMENT_OPTIONS = ['Cash', 'Card', 'PayPal', 'Bank Transfer'] as const;

interface ConvertToPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evaluation: PurchaseEvaluation;
}

/**
 * Expand evaluation items into individual inventory items based on quantity
 */
function expandItemsToInventory(
  items: EvaluationItem[],
  purchaseSource: string
): EditableInventoryItem[] {
  const result: EditableInventoryItem[] = [];

  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      result.push({
        sourceItemId: item.id,
        rowIndex: i,
        set_number: item.setNumber,
        item_name: item.setName || '',
        condition: item.condition,
        status: 'NOT YET RECEIVED',
        source: purchaseSource || '',
        cost: item.allocatedCost,
        listing_value: item.expectedSellPrice,
        listing_platform: item.targetPlatform,
        storage_location: '',
        amazon_asin: item.amazonAsin || '',
        sku: '',
        notes: item.userNotes || '',
      });
    }
  }

  return result;
}

export function ConvertToPurchaseDialog({
  open,
  onOpenChange,
  evaluation,
}: ConvertToPurchaseDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const convertMutation = useConvertEvaluation();

  const [step, setStep] = React.useState<'purchase' | 'inventory'>('purchase');
  const [inventoryItems, setInventoryItems] = React.useState<EditableInventoryItem[]>([]);

  // Initialize form with pre-filled values from evaluation
  const form = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseFormSchema),
    defaultValues: {
      purchase_date: new Date().toISOString().split('T')[0],
      short_description:
        evaluation.name || `Evaluation ${format(new Date(evaluation.createdAt), 'MMM d')}`,
      cost: evaluation.totalCost?.toFixed(2) || '',
      source: '',
      payment_method: '',
      reference: '',
      description: '',
    },
  });

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setStep('purchase');
      form.reset({
        purchase_date: new Date().toISOString().split('T')[0],
        short_description:
          evaluation.name || `Evaluation ${format(new Date(evaluation.createdAt), 'MMM d')}`,
        cost: evaluation.totalCost?.toFixed(2) || '',
        source: '',
        payment_method: '',
        reference: '',
        description: '',
      });
      setInventoryItems([]);
    }
  }, [open, evaluation, form]);

  // Handle proceed to inventory step
  const handleProceedToInventory = (values: PurchaseFormValues) => {
    // Expand evaluation items into inventory items
    const expanded = expandItemsToInventory(evaluation.items || [], values.source || '');
    setInventoryItems(expanded);
    setStep('inventory');
  };

  // Handle final conversion
  const handleConvert = async () => {
    const purchaseValues = form.getValues();

    const request: ConvertEvaluationRequest = {
      purchase: {
        purchase_date: purchaseValues.purchase_date,
        short_description: purchaseValues.short_description,
        cost: parseFloat(purchaseValues.cost),
        source: purchaseValues.source || null,
        payment_method: purchaseValues.payment_method || null,
        reference: purchaseValues.reference || null,
        description: purchaseValues.description || null,
      },
      inventoryItems: inventoryItems.map((item) => ({
        set_number: item.set_number,
        item_name: item.item_name,
        condition: item.condition,
        status: item.status,
        source: item.source,
        cost: item.cost,
        listing_value: item.listing_value,
        listing_platform: item.listing_platform,
        storage_location: item.storage_location,
        amazon_asin: item.amazon_asin,
        sku: item.sku,
        notes: item.notes,
      })),
    };

    try {
      const result = await convertMutation.mutateAsync({
        evaluationId: evaluation.id,
        request,
      });

      toast({
        title: 'Conversion successful',
        description: `Created purchase with ${result.inventoryItemCount} inventory items`,
      });

      onOpenChange(false);

      // Navigate to the new purchase
      router.push(`/purchases/${result.purchase.id}`);
    } catch (error) {
      toast({
        title: 'Conversion failed',
        description: error instanceof Error ? error.message : 'An error occurred',
        variant: 'destructive',
      });
    }
  };

  const isConverting = convertMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Convert to Purchase
          </DialogTitle>
          <DialogDescription>
            {step === 'purchase'
              ? 'Step 1: Review and edit purchase details'
              : 'Step 2: Review and edit inventory items'}
          </DialogDescription>
        </DialogHeader>

        {step === 'purchase' ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleProceedToInventory)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="short_description"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Description *</FormLabel>
                      <FormControl>
                        <Input placeholder="Purchase description" {...field} />
                      </FormControl>
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
                  name="source"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Source</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select source" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SOURCE_OPTIONS.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
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
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select payment method" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {PAYMENT_OPTIONS.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
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
                  name="reference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reference</FormLabel>
                      <FormControl>
                        <Input placeholder="Order number, receipt, etc." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Additional notes..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  Next: Review Items
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </DialogFooter>
            </form>
          </Form>
        ) : (
          <>
            <InventoryItemsEditor items={inventoryItems} onChange={setInventoryItems} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep('purchase')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button onClick={handleConvert} disabled={isConverting}>
                {isConverting ? 'Converting...' : 'Convert to Purchase'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
