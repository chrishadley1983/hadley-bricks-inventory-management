'use client';

import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Trash2, ChevronRight, ChevronLeft, CheckCircle, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLinkToInventory } from '@/hooks/use-scanner';
import type { ScannerPiece, InventoryLinkItem } from '@/types/scanner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConsolidatedItem extends InventoryLinkItem {
  /** Whether this item has been manually matched to an inventory record */
  matched: boolean;
}

interface ScanToInventoryWizardProps {
  sessionId: string;
  pieces: ScannerPiece[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Consolidate accepted (and optionally flagged) pieces by part_id, summing quantities */
function consolidatePieces(
  pieces: ScannerPiece[],
  includeFlagged: boolean
): ConsolidatedItem[] {
  const eligible = pieces.filter(
    (p) => p.status === 'accepted' || (includeFlagged && p.status === 'flagged')
  );

  const map = new Map<string, ConsolidatedItem>();

  for (const piece of eligible) {
    const key = piece.part_id ?? '__unknown__';
    if (map.has(key)) {
      map.get(key)!.quantity += 1;
    } else {
      map.set(key, {
        part_id: piece.part_id ?? '',
        part_name: piece.part_name ?? '',
        category: piece.category ?? '',
        quantity: 1,
        inventory_item_id: undefined,
        matched: false,
      });
    }
  }

  // Filter out items without a part_id
  return Array.from(map.values()).filter((item) => item.part_id);
}

// ─── Step 1 — Review ──────────────────────────────────────────────────────────

interface StepReviewProps {
  items: ConsolidatedItem[];
  includeFlagged: boolean;
  onIncludeFlaggedChange: (val: boolean) => void;
  onQuantityChange: (index: number, qty: number) => void;
  onRemove: (index: number) => void;
}

function StepReview({
  items,
  includeFlagged,
  onIncludeFlaggedChange,
  onQuantityChange,
  onRemove,
}: StepReviewProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {items.length} unique parts consolidated from accepted pieces
        </p>
        <div className="flex items-center gap-2">
          <Label htmlFor="include-flagged" className="text-sm">
            Include flagged
          </Label>
          <Switch
            id="include-flagged"
            checked={includeFlagged}
            onCheckedChange={onIncludeFlaggedChange}
          />
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">
          No accepted pieces to add to inventory.
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto space-y-1 border rounded-md p-1">
          {items.map((item, i) => (
            <div
              key={item.part_id}
              className="flex items-center gap-3 rounded px-3 py-2 hover:bg-muted/50"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.part_id}</p>
                {item.part_name && (
                  <p className="text-xs text-muted-foreground truncate">{item.part_name}</p>
                )}
                {item.category && (
                  <p className="text-xs text-muted-foreground">{item.category}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Label className="text-xs text-muted-foreground">Qty</Label>
                <Input
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => onQuantityChange(i, parseInt(e.target.value, 10) || 1)}
                  className="w-16 h-7 text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => onRemove(i)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step 2 — Match ───────────────────────────────────────────────────────────

interface StepMatchProps {
  items: ConsolidatedItem[];
  onItemChange: (index: number, updates: Partial<ConsolidatedItem>) => void;
}

function StepMatch({ items, onItemChange }: StepMatchProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Optionally link each part to an existing inventory item (by ID). Leave blank to create a
        new record.
      </p>

      <div className="max-h-80 overflow-y-auto space-y-2 border rounded-md p-2">
        {items.map((item, i) => (
          <div key={item.part_id} className="space-y-1 p-2 rounded hover:bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{item.part_id}</p>
                {item.part_name && (
                  <p className="text-xs text-muted-foreground">{item.part_name}</p>
                )}
              </div>
              {item.inventory_item_id ? (
                <Badge variant="default" className="shrink-0">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Matched
                </Badge>
              ) : (
                <Badge variant="secondary" className="shrink-0">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  New
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Paste inventory item UUID to link…"
                value={item.inventory_item_id ?? ''}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  onItemChange(i, {
                    inventory_item_id: val || undefined,
                    matched: !!val,
                  });
                }}
                className="h-7 text-xs font-mono"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Step 3 — Confirm ─────────────────────────────────────────────────────────

interface StepConfirmProps {
  items: ConsolidatedItem[];
  isPending: boolean;
}

function StepConfirm({ items, isPending }: StepConfirmProps) {
  const toCreate = items.filter((i) => !i.inventory_item_id).length;
  const toUpdate = items.filter((i) => !!i.inventory_item_id).length;

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">New inventory records</span>
          <span className="font-semibold tabular-nums">{toCreate}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Existing items to update (qty +)</span>
          <span className="font-semibold tabular-nums">{toUpdate}</span>
        </div>
        <div className="flex items-center justify-between text-sm border-t pt-2 mt-2">
          <span className="text-muted-foreground">Total parts</span>
          <span className="font-semibold tabular-nums">{items.length}</span>
        </div>
      </div>

      {isPending && (
        <p className="text-sm text-muted-foreground text-center">Adding to inventory…</p>
      )}
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

const STEPS = ['Review', 'Match', 'Confirm'] as const;

export function ScanToInventoryWizard({
  sessionId,
  pieces,
  open,
  onOpenChange,
  onComplete,
}: ScanToInventoryWizardProps) {
  const [step, setStep] = useState(0);
  const [includeFlagged, setIncludeFlagged] = useState(false);

  const initialItems = useMemo(
    () => consolidatePieces(pieces, includeFlagged),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pieces, includeFlagged]
  );

  const [items, setItems] = useState<ConsolidatedItem[]>(initialItems);

  // Re-consolidate when toggling flagged (reset items)
  const handleIncludeFlaggedChange = (val: boolean) => {
    setIncludeFlagged(val);
    setItems(consolidatePieces(pieces, val));
  };

  const { mutate: linkToInventory, isPending } = useLinkToInventory();

  function handleQuantityChange(index: number, qty: number) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, quantity: qty } : item)));
  }

  function handleRemove(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function handleItemChange(index: number, updates: Partial<ConsolidatedItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...updates } : item)));
  }

  function handleNext() {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  }

  function handleBack() {
    if (step > 0) setStep((s) => s - 1);
  }

  function handleConfirm() {
    const payload: InventoryLinkItem[] = items.map((item) => ({
      part_id: item.part_id,
      part_name: item.part_name,
      category: item.category,
      quantity: item.quantity,
      inventory_item_id: item.inventory_item_id,
    }));

    linkToInventory(
      { sessionId, items: payload },
      {
        onSuccess: (result) => {
          toast.success(
            `Done! ${result.created} created, ${result.updated} updated.`
          );
          onOpenChange(false);
          onComplete?.();
          // Reset wizard state
          setStep(0);
          setItems(initialItems);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : 'Failed to add to inventory');
        },
      }
    );
  }

  function handleOpenChange(val: boolean) {
    if (!isPending) {
      onOpenChange(val);
      if (!val) {
        setStep(0);
        setItems(consolidatePieces(pieces, false));
        setIncludeFlagged(false);
      }
    }
  }

  const canGoNext = items.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to Inventory</DialogTitle>
          {/* Step indicator */}
          <div className="flex items-center gap-1 pt-1">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-1">
                <div
                  className={`h-6 rounded-full px-2 text-xs flex items-center font-medium transition-colors ${
                    i === step
                      ? 'bg-primary text-primary-foreground'
                      : i < step
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-muted/30 text-muted-foreground/50'
                  }`}
                >
                  {i + 1}. {label}
                </div>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                )}
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="py-2">
          {step === 0 && (
            <StepReview
              items={items}
              includeFlagged={includeFlagged}
              onIncludeFlaggedChange={handleIncludeFlaggedChange}
              onQuantityChange={handleQuantityChange}
              onRemove={handleRemove}
            />
          )}
          {step === 1 && <StepMatch items={items} onItemChange={handleItemChange} />}
          {step === 2 && <StepConfirm items={items} isPending={isPending} />}
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            variant="ghost"
            onClick={step === 0 ? () => handleOpenChange(false) : handleBack}
            disabled={isPending}
          >
            {step === 0 ? (
              'Cancel'
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </>
            )}
          </Button>

          {step < STEPS.length - 1 ? (
            <Button onClick={handleNext} disabled={!canGoNext}>
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleConfirm} disabled={isPending || items.length === 0}>
              {isPending ? 'Adding…' : 'Confirm & Add'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
