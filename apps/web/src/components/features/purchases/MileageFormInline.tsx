'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2, Calculator, Loader2, Car, ParkingCircle, AlertCircle } from 'lucide-react';
import { useHomeAddress, useCalculateMileage } from '@/hooks';
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
import type { ExpenseType } from '@/lib/api';

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

export interface PendingMileageEntry {
  id: string;
  trackingDate: string;
  destinationPostcode: string;
  milesTravelled: number;
  amountClaimed: number;
  reason: string;
  expenseType: ExpenseType;
  notes?: string;
}

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

interface MileageFormInlineProps {
  purchaseDate: string;
  pendingEntries: PendingMileageEntry[];
  onEntriesChange: (entries: PendingMileageEntry[]) => void;
}

export function MileageFormInline({
  purchaseDate,
  pendingEntries,
  onEntriesChange,
}: MileageFormInlineProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: homeAddress } = useHomeAddress();
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

  const handleEdit = (entry: PendingMileageEntry) => {
    form.reset({
      trackingDate: entry.trackingDate,
      destinationPostcode: entry.destinationPostcode,
      milesTravelled: entry.milesTravelled.toString(),
      amountClaimed: entry.amountClaimed.toString(),
      reason: entry.reason,
      expenseType: entry.expenseType,
      notes: entry.notes || '',
    });
    setEditingId(entry.id);
    setShowForm(true);
  };

  const handleDelete = (entryId: string) => {
    onEntriesChange(pendingEntries.filter((e) => e.id !== entryId));
  };

  const onSubmit = (values: MileageFormValues) => {
    const entry: PendingMileageEntry = {
      id: editingId || `pending-${Date.now()}`,
      trackingDate: values.trackingDate,
      destinationPostcode: values.destinationPostcode,
      milesTravelled: parseFloat(values.milesTravelled) || 0,
      amountClaimed: parseFloat(values.amountClaimed) || 0,
      reason: values.reason,
      expenseType: values.expenseType,
      notes: values.notes || undefined,
    };

    if (editingId) {
      onEntriesChange(pendingEntries.map((e) => (e.id === editingId ? entry : e)));
    } else {
      onEntriesChange([...pendingEntries, entry]);
    }

    resetForm();
  };

  // Calculate totals
  const totalMiles = pendingEntries
    .filter((e) => e.expenseType === 'mileage')
    .reduce((sum, e) => sum + e.milesTravelled, 0);
  const totalCost = pendingEntries.reduce((sum, e) => sum + e.amountClaimed, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">Collection & Mileage</CardTitle>
          <CardDescription>Track travel costs for this purchase</CardDescription>
        </div>
        {!showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        {pendingEntries.length > 0 && (
          <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
            <div className="text-center">
              <div className="text-2xl font-bold">{totalMiles.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">Total Miles</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{formatCurrency(totalCost)}</div>
              <div className="text-xs text-muted-foreground">Total Cost</div>
            </div>
          </div>
        )}

        {/* Existing entries */}
        {pendingEntries.length > 0 && (
          <div className="space-y-2">
            {pendingEntries.map((entry) => {
              const TypeIcon =
                EXPENSE_TYPES.find((t) => t.value === entry.expenseType)?.icon || Car;
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
                        {entry.trackingDate} · {entry.destinationPostcode}
                        {entry.expenseType === 'mileage' && ` · ${entry.milesTravelled} miles`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="font-medium">{formatCurrency(entry.amountClaimed)}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {entry.expenseType}
                      </div>
                    </div>
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
                        onClick={() => handleDelete(entry.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!showForm && pendingEntries.length === 0 && (
          <p className="text-center text-muted-foreground py-4">No mileage or expenses added yet</p>
        )}

        {/* Add/Edit Form */}
        {showForm && (
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
                    Set your home address in Report Settings to enable automatic distance
                    calculation.
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
                <Button type="button" onClick={form.handleSubmit(onSubmit)}>
                  {editingId ? 'Update' : 'Add'}
                </Button>
              </div>
            </div>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
