'use client';

import { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { useCompletePickup, type StockPickup, type CompletePickupInput } from '@/hooks/use-pickups';

interface CompletePickupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pickup: StockPickup | null;
}

const OUTCOMES = [
  {
    value: 'successful',
    label: 'Successful',
    description: 'Got everything as expected',
  },
  {
    value: 'partial',
    label: 'Partial',
    description: 'Got some items, not all',
  },
  {
    value: 'unsuccessful',
    label: 'Unsuccessful',
    description: 'Did not get any items',
  },
  {
    value: 'rescheduled',
    label: 'Rescheduled',
    description: 'Will try again another day',
  },
] as const;

export function CompletePickupDialog({ open, onOpenChange, pickup }: CompletePickupDialogProps) {
  const { toast } = useToast();
  const completePickup = useCompletePickup();

  const [formData, setFormData] = useState<Omit<CompletePickupInput, 'id'>>({
    outcome: 'successful',
    final_amount_paid: null,
    completion_notes: null,
    mileage: null,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pickup) return;

    try {
      await completePickup.mutateAsync({
        id: pickup.id,
        ...formData,
      });
      toast({
        title: 'Pickup completed',
        description: `${pickup.title} has been marked as ${formData.outcome}.`,
      });
      onOpenChange(false);
      // Reset form
      setFormData({
        outcome: 'successful',
        final_amount_paid: null,
        completion_notes: null,
        mileage: null,
      });
    } catch {
      toast({
        title: 'Failed to complete pickup',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const updateField = <K extends keyof Omit<CompletePickupInput, 'id'>>(
    field: K,
    value: Omit<CompletePickupInput, 'id'>[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  if (!pickup) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Complete Pickup
          </DialogTitle>
          <DialogDescription>Record the outcome of: {pickup.title}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Outcome */}
          <div className="space-y-2">
            <Label>Outcome *</Label>
            <RadioGroup
              value={formData.outcome}
              onValueChange={(value: string) =>
                updateField(
                  'outcome',
                  value as 'successful' | 'partial' | 'unsuccessful' | 'rescheduled'
                )
              }
              className="space-y-2"
            >
              {OUTCOMES.map((outcome) => (
                <div key={outcome.value} className="flex items-start space-x-3 space-y-0">
                  <RadioGroupItem value={outcome.value} id={outcome.value} />
                  <Label htmlFor={outcome.value} className="font-normal cursor-pointer">
                    <span className="font-medium">{outcome.label}</span>
                    <p className="text-xs text-muted-foreground">{outcome.description}</p>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Final Amount Paid */}
          <div className="space-y-2">
            <Label htmlFor="final_amount_paid">
              Final Amount Paid
              {pickup.agreed_price && (
                <span className="text-muted-foreground font-normal ml-1">
                  (Agreed: £{pickup.agreed_price.toFixed(2)})
                </span>
              )}
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                £
              </span>
              <Input
                id="final_amount_paid"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                className="pl-7"
                value={formData.final_amount_paid ?? ''}
                onChange={(e) =>
                  updateField(
                    'final_amount_paid',
                    e.target.value ? parseFloat(e.target.value) : null
                  )
                }
              />
            </div>
          </div>

          {/* Mileage */}
          <div className="space-y-2">
            <Label htmlFor="mileage">
              Round Trip Mileage
              <span className="text-muted-foreground font-normal ml-1">(for expense tracking)</span>
            </Label>
            <div className="relative">
              <Input
                id="mileage"
                type="number"
                step="0.1"
                min="0"
                placeholder="0"
                value={formData.mileage ?? ''}
                onChange={(e) =>
                  updateField('mileage', e.target.value ? parseFloat(e.target.value) : null)
                }
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                miles
              </span>
            </div>
            {formData.mileage && (
              <p className="text-xs text-muted-foreground">
                Mileage cost: £{(formData.mileage * 0.45).toFixed(2)} (at £0.45/mile HMRC rate)
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="completion_notes">Notes</Label>
            <Textarea
              id="completion_notes"
              placeholder="Any notes about this pickup..."
              value={formData.completion_notes || ''}
              onChange={(e) => updateField('completion_notes', e.target.value || null)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={completePickup.isPending}>
              {completePickup.isPending ? 'Saving...' : 'Complete Pickup'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
