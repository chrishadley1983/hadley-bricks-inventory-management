'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Loader2 } from 'lucide-react';
import { usePresets, useCreateFromPreset } from '@/hooks/use-workflow';
import { useToast } from '@/hooks/use-toast';
import { QuickAddTaskDialog } from './QuickAddTaskDialog';

interface AddTaskDropdownProps {
  className?: string;
}

export function AddTaskDropdown({ className }: AddTaskDropdownProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: presetsData, isLoading: presetsLoading } = usePresets();
  const createFromPreset = useCreateFromPreset();
  const { toast } = useToast();

  const handlePresetClick = async (presetId: string, presetName: string) => {
    try {
      await createFromPreset.mutateAsync(presetId);
      toast({ title: `Added: ${presetName}` });
    } catch {
      toast({ title: 'Failed to add task', variant: 'destructive' });
    }
  };

  const presets = presetsData?.presets ?? [];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={className}>
            <Plus className="h-4 w-4 mr-1" />
            Add Task
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Custom Task...
          </DropdownMenuItem>

          {presets.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                Quick Add
              </div>
              {presetsLoading ? (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : (
                presets.map((preset) => (
                  <DropdownMenuItem
                    key={preset.id}
                    onSelect={() => handlePresetClick(preset.id, preset.name)}
                    disabled={createFromPreset.isPending}
                  >
                    {preset.icon && <span className="mr-2">{preset.icon}</span>}
                    {preset.name}
                    {preset.default_duration_minutes && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {preset.default_duration_minutes}m
                      </span>
                    )}
                  </DropdownMenuItem>
                ))
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <QuickAddTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
