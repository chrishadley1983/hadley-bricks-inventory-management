'use client';

/**
 * Edit Scenario Dialog Component
 * Dialog for renaming a scenario and adding notes/description
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface EditScenarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string, description: string) => void;
  isPending?: boolean;
  currentName: string;
  currentDescription: string | null;
}

export function EditScenarioDialog({
  open,
  onOpenChange,
  onSave,
  isPending,
  currentName,
  currentDescription,
}: EditScenarioDialogProps) {
  const [name, setName] = useState(currentName);
  const [description, setDescription] = useState(currentDescription || '');

  // Reset form when dialog opens with new values
  useEffect(() => {
    if (open) {
      setName(currentName);
      setDescription(currentDescription || '');
    }
  }, [open, currentName, currentDescription]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim(), description.trim());
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setName(currentName);
      setDescription(currentDescription || '');
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Scenario</DialogTitle>
            <DialogDescription>
              Rename your scenario and add notes to help you remember what it represents.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="scenario-name">Scenario Name</Label>
              <Input
                id="scenario-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Q1 2026 Projection"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="scenario-notes">Notes</Label>
              <Textarea
                id="scenario-notes"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add notes about this scenario..."
                rows={4}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Optional. Add context like assumptions, purpose, or key changes from other
                scenarios.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
