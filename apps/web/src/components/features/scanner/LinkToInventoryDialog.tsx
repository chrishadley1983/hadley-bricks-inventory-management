'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLinkPiece } from '@/hooks/use-scanner';
import type { ScannerPiece } from '@/types/scanner';

interface LinkToInventoryDialogProps {
  piece: ScannerPiece;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked?: (piece: ScannerPiece) => void;
}

export function LinkToInventoryDialog({
  piece,
  open,
  onOpenChange,
  onLinked,
}: LinkToInventoryDialogProps) {
  const [inventoryItemId, setInventoryItemId] = useState('');
  const { mutate: linkPiece, isPending } = useLinkPiece();

  // Determine current link state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentInventoryItemId = (piece as any).inventory_item_id as string | undefined;
  const isAlreadyLinked = !!currentInventoryItemId;

  function handleLink() {
    const trimmed = inventoryItemId.trim();
    if (!trimmed) {
      toast.error('Please enter an inventory item ID');
      return;
    }

    linkPiece(
      { pieceId: piece.id, inventoryItemId: trimmed },
      {
        onSuccess: (updatedPiece) => {
          toast.success('Piece linked to inventory item');
          onLinked?.(updatedPiece);
          onOpenChange(false);
          setInventoryItemId('');
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : 'Failed to link piece');
        },
      }
    );
  }

  function handleOpenChange(val: boolean) {
    if (!isPending) {
      onOpenChange(val);
      if (!val) setInventoryItemId('');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link to Inventory</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Piece summary */}
          <div className="rounded-md border p-3 space-y-1">
            <p className="text-sm font-medium">{piece.part_id ?? '—'}</p>
            {piece.part_name && (
              <p className="text-sm text-muted-foreground">{piece.part_name}</p>
            )}
            {piece.category && (
              <p className="text-xs text-muted-foreground">{piece.category}</p>
            )}
          </div>

          {isAlreadyLinked ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Currently linked to inventory item:
              </p>
              <p className="font-mono text-xs bg-muted rounded p-2 break-all">
                {currentInventoryItemId}
              </p>
              <p className="text-xs text-muted-foreground">
                To re-link, close this dialog and open it again — linking to a new item will overwrite the current link.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="inv-item-id" className="text-sm">
                Inventory Item ID
              </Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="inv-item-id"
                  placeholder="Paste UUID of inventory item…"
                  value={inventoryItemId}
                  onChange={(e) => setInventoryItemId(e.target.value)}
                  className="pl-8 font-mono text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleLink();
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Copy the ID from the inventory table and paste it here.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          {!isAlreadyLinked && (
            <Button onClick={handleLink} disabled={isPending || !inventoryItemId.trim()}>
              {isPending ? 'Linking…' : 'Link'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
