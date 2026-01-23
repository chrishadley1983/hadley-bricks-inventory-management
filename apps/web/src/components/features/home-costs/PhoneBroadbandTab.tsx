'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useCreateHomeCost,
  useUpdateHomeCost,
  useDeleteHomeCost,
} from '@/hooks/use-home-costs';
import { MonthPicker } from './MonthPicker';
import type { HomeCost, PhoneBroadbandPreset } from '@/types/home-costs';
import { PHONE_BROADBAND_PRESETS, calculatePhoneBroadbandClaimable } from '@/types/home-costs';

interface PhoneBroadbandTabProps {
  existingCosts: HomeCost[];
  isLoading?: boolean;
}

interface EditingCost {
  id?: string;
  description: PhoneBroadbandPreset | '';
  monthlyCost: string;
  businessPercent: string;
  startDate: string;
  endDate: string | null;
  isOngoing: boolean;
}

const defaultEditingCost: EditingCost = {
  description: '',
  monthlyCost: '',
  businessPercent: '',
  startDate: '',
  endDate: null,
  isOngoing: true,
};

/**
 * Phone & Broadband Tab
 * Allows configuring multiple phone/broadband costs with business percentages
 * F32-F44: Phone & Broadband Tab criteria
 */
export function PhoneBroadbandTab({ existingCosts, isLoading }: PhoneBroadbandTabProps) {
  const { toast } = useToast();
  const createMutation = useCreateHomeCost();
  const updateMutation = useUpdateHomeCost();
  const deleteMutation = useDeleteHomeCost();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EditingCost>(defaultEditingCost);

  const openAddDialog = () => {
    const now = new Date();
    setEditing({
      ...defaultEditingCost,
      startDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    });
    setDialogOpen(true);
  };

  const openEditDialog = (cost: HomeCost) => {
    setEditing({
      id: cost.id,
      description: (cost.description as PhoneBroadbandPreset) || '',
      monthlyCost: cost.monthlyCost?.toString() || '',
      businessPercent: cost.businessPercent?.toString() || '',
      startDate: cost.startDate,
      endDate: cost.endDate,
      isOngoing: !cost.endDate,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editing.description) {
      toast({
        title: 'Description required',
        description: 'Please select a cost type.',
        variant: 'destructive',
      });
      return;
    }

    const monthlyCost = parseFloat(editing.monthlyCost);
    const businessPercent = parseInt(editing.businessPercent, 10);

    if (isNaN(monthlyCost) || monthlyCost <= 0) {
      toast({
        title: 'Invalid monthly cost',
        description: 'Monthly cost must be a positive number.',
        variant: 'destructive',
      });
      return;
    }

    if (isNaN(businessPercent) || businessPercent < 1 || businessPercent > 100) {
      toast({
        title: 'Invalid business percentage',
        description: 'Business percentage must be between 1 and 100.',
        variant: 'destructive',
      });
      return;
    }

    if (!editing.startDate) {
      toast({
        title: 'Start date required',
        description: 'Please select a start date.',
        variant: 'destructive',
      });
      return;
    }

    const finalEndDate = editing.isOngoing ? null : editing.endDate;

    if (finalEndDate && finalEndDate < editing.startDate) {
      toast({
        title: 'Invalid date range',
        description: 'End date must be on or after start date.',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (editing.id) {
        await updateMutation.mutateAsync({
          id: editing.id,
          data: {
            description: editing.description as PhoneBroadbandPreset,
            monthlyCost,
            businessPercent,
            startDate: editing.startDate,
            endDate: finalEndDate,
          },
        });
      } else {
        await createMutation.mutateAsync({
          costType: 'phone_broadband',
          description: editing.description as PhoneBroadbandPreset,
          monthlyCost,
          businessPercent,
          startDate: editing.startDate,
          endDate: finalEndDate,
        });
      }
      toast({ title: 'Phone & Broadband cost saved' });
      setDialogOpen(false);
      setEditing(defaultEditingCost);
    } catch (error) {
      toast({
        title: 'Failed to save',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!editing.id) return;

    try {
      await deleteMutation.mutateAsync(editing.id);
      toast({ title: 'Phone & Broadband cost deleted' });
      setDialogOpen(false);
      setEditing(defaultEditingCost);
    } catch (error) {
      toast({
        title: 'Failed to delete',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  // Calculate totals
  const totalMonthlyClaimable = existingCosts.reduce((sum, cost) => {
    const claimable = calculatePhoneBroadbandClaimable(
      cost.monthlyCost ?? 0,
      cost.businessPercent ?? 0
    );
    return sum + claimable;
  }, 0);
  const annualEstimate = totalMonthlyClaimable * 12;

  // Calculate claimable for dialog preview
  const dialogMonthlyCost = parseFloat(editing.monthlyCost) || 0;
  const dialogBusinessPercent = parseInt(editing.businessPercent, 10) || 0;
  const dialogClaimable = calculatePhoneBroadbandClaimable(
    dialogMonthlyCost,
    dialogBusinessPercent
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Add phone and broadband costs with their business use percentage.
      </div>

      {/* Costs table */}
      {existingCosts.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Monthly</TableHead>
              <TableHead className="text-right">Business %</TableHead>
              <TableHead className="text-right">Claimable</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {existingCosts.map((cost) => (
              <TableRow key={cost.id}>
                <TableCell>{cost.description}</TableCell>
                <TableCell className="text-right">
                  £{(cost.monthlyCost ?? 0).toFixed(2)}
                </TableCell>
                <TableCell className="text-right">{cost.businessPercent}%</TableCell>
                <TableCell className="text-right">
                  £{calculatePhoneBroadbandClaimable(
                    cost.monthlyCost ?? 0,
                    cost.businessPercent ?? 0
                  ).toFixed(2)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(cost)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="text-center py-8 text-muted-foreground border rounded-lg">
          No phone or broadband costs configured
        </div>
      )}

      {/* Add button */}
      <Button variant="outline" onClick={openAddDialog}>
        <Plus className="h-4 w-4 mr-2" />
        Add Cost
      </Button>

      {/* Totals */}
      {existingCosts.length > 0 && (
        <div className="rounded-lg bg-muted p-4 space-y-2">
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Total Monthly Claimable</span>
            <span className="font-medium">£{totalMonthlyClaimable.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Annual Estimate</span>
            <span className="font-medium">£{annualEstimate.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing.id ? 'Edit Phone & Broadband Cost' : 'Add Phone & Broadband Cost'}
            </DialogTitle>
            <DialogDescription>
              Configure the cost details and business use percentage.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Description preset */}
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={editing.description}
                onValueChange={(value: string) =>
                  setEditing({ ...editing, description: value as PhoneBroadbandPreset })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {PHONE_BROADBAND_PRESETS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {preset}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Monthly cost */}
            <div className="space-y-2">
              <Label>Monthly Cost</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  £
                </span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="pl-7"
                  value={editing.monthlyCost}
                  onChange={(e) => setEditing({ ...editing, monthlyCost: e.target.value })}
                />
              </div>
            </div>

            {/* Business percentage */}
            <div className="space-y-2">
              <Label>Business Use %</Label>
              <div className="relative">
                <Input
                  type="number"
                  min="1"
                  max="100"
                  className="pr-7"
                  value={editing.businessPercent}
                  onChange={(e) => setEditing({ ...editing, businessPercent: e.target.value })}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  %
                </span>
              </div>
            </div>

            {/* Calculated claimable */}
            {dialogMonthlyCost > 0 && dialogBusinessPercent > 0 && (
              <div className="rounded-lg bg-muted p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Claimable Amount</span>
                  <span className="font-medium">£{dialogClaimable.toFixed(2)}/month</span>
                </div>
              </div>
            )}

            {/* Date range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <MonthPicker
                  value={editing.startDate}
                  onChange={(value) => setEditing({ ...editing, startDate: value })}
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="pb-ongoing"
                      checked={editing.isOngoing}
                      onCheckedChange={(checked: boolean) => {
                        setEditing({
                          ...editing,
                          isOngoing: checked === true,
                          endDate: checked ? null : editing.endDate,
                        });
                      }}
                    />
                    <Label htmlFor="pb-ongoing" className="font-normal cursor-pointer">
                      Ongoing
                    </Label>
                  </div>
                  {!editing.isOngoing && (
                    <MonthPicker
                      value={editing.endDate ?? ''}
                      onChange={(value) => setEditing({ ...editing, endDate: value })}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="flex justify-between">
            {editing.id && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting || isSaving}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            )}
            <div className={editing.id ? '' : 'ml-auto'}>
              <Button onClick={handleSave} disabled={isSaving || isDeleting}>
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
