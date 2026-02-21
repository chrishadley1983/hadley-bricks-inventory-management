'use client';

/**
 * Scenario Selector Component
 * Dropdown with scenario list and action buttons
 */

import { useState } from 'react';
import { format } from 'date-fns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Loader2, Plus, Copy, Trash2, MoreHorizontal, Pencil } from 'lucide-react';
import {
  useCreateCostScenario,
  useDeleteCostScenario,
  useDuplicateCostScenario,
  useRenameCostScenario,
} from '@/hooks/use-cost-modelling';
import { useToast } from '@/hooks/use-toast';
import type { ScenarioListItem } from '@/types/cost-modelling';
import { SaveAsDialog } from './SaveAsDialog';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { EditScenarioDialog } from './EditScenarioDialog';

interface ScenarioSelectorProps {
  scenarios: ScenarioListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

export function ScenarioSelector({
  scenarios,
  selectedId,
  onSelect,
  disabled,
}: ScenarioSelectorProps) {
  const { toast } = useToast();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const createMutation = useCreateCostScenario();
  const deleteMutation = useDeleteCostScenario();
  const duplicateMutation = useDuplicateCostScenario();
  const renameMutation = useRenameCostScenario();

  const selectedScenario = scenarios.find((s) => s.id === selectedId);
  const isLastScenario = scenarios.length <= 1;

  const handleCreate = async (name: string) => {
    try {
      const scenario = await createMutation.mutateAsync({ name });
      onSelect(scenario.id);
      toast({ title: 'Scenario created' });
      setShowNewDialog(false);
    } catch (error) {
      if (error instanceof Error) {
        toast({ title: error.message, variant: 'destructive' });
      }
    }
  };

  const handleDuplicate = async () => {
    if (!selectedId) return;
    try {
      const scenario = await duplicateMutation.mutateAsync(selectedId);
      onSelect(scenario.id);
      toast({ title: 'Scenario duplicated' });
    } catch (error) {
      if (error instanceof Error) {
        toast({ title: error.message, variant: 'destructive' });
      }
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    try {
      await deleteMutation.mutateAsync(selectedId);
      // Select another scenario
      const remaining = scenarios.filter((s) => s.id !== selectedId);
      if (remaining.length > 0) {
        onSelect(remaining[0].id);
      }
      toast({ title: 'Scenario deleted' });
      setShowDeleteDialog(false);
    } catch (error) {
      if (error instanceof Error) {
        toast({ title: error.message, variant: 'destructive' });
      }
    }
  };

  const handleRename = async (name: string, description: string) => {
    if (!selectedId) return;
    try {
      await renameMutation.mutateAsync({ id: selectedId, name, description });
      toast({ title: 'Scenario updated' });
      setShowEditDialog(false);
    } catch (error) {
      if (error instanceof Error) {
        toast({ title: error.message, variant: 'destructive' });
      }
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Scenario dropdown */}
      <Select value={selectedId || ''} onValueChange={onSelect} disabled={disabled}>
        <SelectTrigger className="w-[240px]">
          <SelectValue placeholder="Select scenario" />
        </SelectTrigger>
        <SelectContent>
          {scenarios.map((scenario) => (
            <SelectItem key={scenario.id} value={scenario.id}>
              <div className="flex flex-col">
                <span>{scenario.name}</span>
                {/* F56: Show last modified date */}
                <span className="text-xs text-muted-foreground">
                  Modified: {format(new Date(scenario.updated_at), 'MMM d, yyyy')}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* New button */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => setShowNewDialog(true)}
        disabled={createMutation.isPending}
        title="Create new scenario"
      >
        {createMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
      </Button>

      {/* More actions dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" disabled={!selectedId}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Rename / Edit Notes
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDuplicate} disabled={duplicateMutation.isPending}>
            <Copy className="mr-2 h-4 w-4" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setShowDeleteDialog(true)}
            disabled={isLastScenario}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
            {isLastScenario && <span className="ml-2 text-xs">(last scenario)</span>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save As / New dialog */}
      <SaveAsDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        onSave={handleCreate}
        isPending={createMutation.isPending}
        title="Create New Scenario"
        description="Enter a name for your new scenario"
      />

      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDelete}
        isPending={deleteMutation.isPending}
        scenarioName={selectedScenario?.name || ''}
      />

      {/* Edit scenario dialog */}
      <EditScenarioDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onSave={handleRename}
        isPending={renameMutation.isPending}
        currentName={selectedScenario?.name || ''}
        currentDescription={selectedScenario?.description || null}
      />
    </div>
  );
}
