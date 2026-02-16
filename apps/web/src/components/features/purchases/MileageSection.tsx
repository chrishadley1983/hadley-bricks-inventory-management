'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2, Calculator, Loader2, Car, ParkingCircle, AlertCircle } from 'lucide-react';
import {
  useMileageForPurchase,
  useCreateMileage,
  useUpdateMileage,
  useDeleteMileage,
  useHomeAddress,
  useCalculateMileage,
} from '@/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatCurrency } from '@/lib/utils';
import type { Database } from '@hadley-bricks/database';
import type { ExpenseType } from '@/lib/api';

type MileageTracking = Database['public']['Tables']['mileage_tracking']['Row'];

const DEFAULT_MILEAGE_RATE = 0.45;

const mileageFormSchema = z.object({
  trackingDate: z.string().min(1, 'Date is required'),
  destinationPostcode: z.string().min(1, 'Destination postcode is required'),
  milesTravelled: z.string().min(1, 'Miles is required'),
  amountClaimed: z.string().min(1, 'Amount is required'),
  reason: z.string().min(1, 'Reason is required'),
  expenseType: z.enum(['mileage', 'parking', 'toll', 'other'] as const),
  notes: z.string().optional(),
});

type MileageFormValues = z.infer<typeof mileageFormSchema>;

const EXPENSE_TYPES: { value: ExpenseType; label: string; icon: React.ElementType }[] = [
  { value: 'mileage', label: 'Mileage', icon: Car },
  { value: 'parking', label: 'Parking', icon: ParkingCircle },
  { value: 'toll', label: 'Toll/Congestion', icon: AlertCircle },
  { value: 'other', label: 'Other', icon: Plus },
];

const REASON_OPTIONS = [
  { value: 'Collection', label: 'Collection' },
  { value: 'Delivery', label: 'Delivery' },
  { value: 'Viewing', label: 'Viewing' },
  { value: 'Car Boot', label: 'Car Boot' },
  { value: 'Auction', label: 'Auction' },
  { value: 'Other', label: 'Other' },
];

interface MileageSectionProps {
  purchaseId: string | undefined;
  purchaseDate?: string;
  readOnly?: boolean;
}

export function MileageSection({ purchaseId, purchaseDate, readOnly = false }: MileageSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: mileageSummary, isLoading, error } = useMileageForPurchase(purchaseId);
  const { data: homeAddress } = useHomeAddress();
  const createMutation = useCreateMileage();
  const updateMutation = useUpdateMileage();
  const deleteMutation = useDeleteMileage();
  const calculateMileageMutation = useCalculateMileage();

  const today = new Date().toISOString().split('T')[0];

  const form = useForm<MileageFormValues>({
    resolver: zodResolver(mileageFormSchema),
    defaultValues: {
      trackingDate: purchaseDate || today,
      destinationPostcode: '',
      milesTravelled: '',
      amountClaimed: '',
      reason: 'Collection',
      expenseType: 'mileage',
      notes: '',
    },
  });

  const expenseType = form.watch('expenseType');

  // Auto-calculate amount when miles change for mileage type
  const handleCalculateDistance = async () => {
    const destination = form.getValues('destinationPostcode');
    if (!destination || !homeAddress) {
      return;
    }

    try {
      const result = await calculateMileageMutation.mutateAsync({
        fromPostcode: homeAddress,
        toPostcode: destination,
      });

      form.setValue('milesTravelled', result.roundTrip.toString());
      form.setValue('amountClaimed', (result.roundTrip * DEFAULT_MILEAGE_RATE).toFixed(2));
    } catch (err) {
      console.error('Failed to calculate distance:', err);
    }
  };

  const handleMilesChange = (value: string) => {
    form.setValue('milesTravelled', value);
    if (expenseType === 'mileage' && value) {
      const milesNum = parseFloat(value);
      if (!isNaN(milesNum)) {
        form.setValue('amountClaimed', (milesNum * DEFAULT_MILEAGE_RATE).toFixed(2));
      }
    }
  };

  const resetForm = () => {
    form.reset({
      trackingDate: purchaseDate || today,
      destinationPostcode: '',
      milesTravelled: '',
      amountClaimed: '',
      reason: 'Collection',
      expenseType: 'mileage',
      notes: '',
    });
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (entry: MileageTracking) => {
    form.reset({
      trackingDate: entry.tracking_date,
      destinationPostcode: entry.destination_postcode,
      milesTravelled: entry.miles_travelled.toString(),
      amountClaimed: entry.amount_claimed.toString(),
      reason: entry.reason,
      expenseType: entry.expense_type as ExpenseType,
      notes: entry.notes || '',
    });
    setEditingId(entry.id);
    setShowForm(true);
  };

  const handleDelete = async (entry: MileageTracking) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;
    await deleteMutation.mutateAsync({ id: entry.id, purchaseId: entry.purchase_id });
  };

  const onSubmit = async (values: MileageFormValues) => {
    const data = {
      purchaseId,
      trackingDate: values.trackingDate,
      destinationPostcode: values.destinationPostcode,
      milesTravelled: parseFloat(values.milesTravelled) || 0,
      amountClaimed: parseFloat(values.amountClaimed) || 0,
      reason: values.reason,
      expenseType: values.expenseType,
      notes: values.notes || undefined,
    };

    if (editingId) {
      await updateMutation.mutateAsync({ id: editingId, data });
    } else {
      await createMutation.mutateAsync(data);
    }

    resetForm();
  };

  if (!purchaseId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Collection & Mileage</CardTitle>
          <CardDescription>Track travel costs for this purchase</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertDescription>
              Save the purchase first to add mileage tracking.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const entries = mileageSummary?.entries || [];
  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">Collection & Mileage</CardTitle>
          <CardDescription>Track travel costs for this purchase</CardDescription>
        </div>
        {!readOnly && !showForm && (
          <Button type="button" size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        {mileageSummary && mileageSummary.totalCost > 0 && (
          <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
            <div className="text-center">
              <div className="text-2xl font-bold">{mileageSummary.totalMiles.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">Total Miles</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{formatCurrency(mileageSummary.totalMileageCost)}</div>
              <div className="text-xs text-muted-foreground">Mileage Cost</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{formatCurrency(mileageSummary.totalCost)}</div>
              <div className="text-xs text-muted-foreground">Total Cost</div>
            </div>
          </div>
        )}

        {/* Existing entries */}
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>Failed to load mileage data</AlertDescription>
          </Alert>
        ) : entries.length > 0 ? (
          <div className="space-y-2">
            {entries.map((entry) => {
              const TypeIcon = EXPENSE_TYPES.find((t) => t.value === entry.expense_type)?.icon || Car;
              return (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <TypeIcon className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{entry.reason}</div>
                      <div className="text-sm text-muted-foreground">
                        {entry.tracking_date} · {entry.destination_postcode}
                        {entry.expense_type === 'mileage' && ` · ${entry.miles_travelled} miles`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="font-medium">{formatCurrency(entry.amount_claimed)}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {entry.expense_type}
                      </div>
                    </div>
                    {!readOnly && (
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(entry)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(entry)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : !showForm ? (
          <p className="text-center text-muted-foreground py-4">
            No mileage or expenses recorded yet
          </p>
        ) : null}

        {/* Add/Edit Form */}
        {showForm && !readOnly && (
          <Form {...form}>
            <div className="space-y-4 border-t pt-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="expenseType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {EXPENSE_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
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
                  name="trackingDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
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
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select reason" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {REASON_OPTIONS.map((option) => (
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
                  name="destinationPostcode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Destination Postcode</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input placeholder="e.g., TN30 6QD" {...field} />
                        </FormControl>
                        {expenseType === 'mileage' && homeAddress && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={handleCalculateDistance}
                            disabled={calculateMileageMutation.isPending || !field.value}
                            title="Calculate distance from home"
                          >
                            {calculateMileageMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Calculator className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {expenseType === 'mileage' && !homeAddress && (
                <Alert>
                  <AlertDescription>
                    Set your home address in Report Settings to enable automatic distance calculation.
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="milesTravelled"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Miles (Round Trip)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="0"
                          {...field}
                          onChange={(e) => handleMilesChange(e.target.value)}
                          disabled={expenseType !== 'mileage'}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="amountClaimed"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount (£)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="0.00" {...field} />
                      </FormControl>
                      {expenseType === 'mileage' && (
                        <p className="text-xs text-muted-foreground">
                          Calculated at {DEFAULT_MILEAGE_RATE * 100}p per mile
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Any additional notes..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
                <Button type="button" disabled={isSubmitting} onClick={form.handleSubmit(onSubmit)}>
                  {isSubmitting ? 'Saving...' : editingId ? 'Update' : 'Add'}
                </Button>
              </div>
            </div>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
