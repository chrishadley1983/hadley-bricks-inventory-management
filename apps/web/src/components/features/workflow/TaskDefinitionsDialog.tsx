'use client';

import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Settings2,
  Plus,
  Pencil,
  Trash2,
  Calendar as CalendarIcon,
  Clock,
  AlertCircle,
  CalendarDays,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  useTaskDefinitions,
  useUpdateDefinition,
  useCreateDefinition,
  useDeleteDefinition,
  useFutureTasks,
  useUpdateFutureTask,
  useDeleteFutureTask,
  type TaskDefinition,
  type FutureTask,
} from '@/hooks/use-workflow';
import { cn } from '@/lib/utils';

interface TaskDefinitionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Daily',
  twice_daily: 'Twice Daily',
  twice_weekly: 'Twice Weekly',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  biannual: 'Biannual',
  adhoc: 'Ad-hoc',
};

const CATEGORY_OPTIONS = [
  { value: 'Shipping', label: 'Shipping' },
  { value: 'Admin', label: 'Admin' },
  { value: 'Sourcing', label: 'Sourcing' },
  { value: 'Listing', label: 'Listing' },
  { value: 'Development', label: 'Development' },
  { value: 'Other', label: 'Other' },
];

const DAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

const PRIORITY_OPTIONS = [
  { value: 1, label: 'Critical', color: 'text-red-600' },
  { value: 2, label: 'Important', color: 'text-amber-600' },
  { value: 3, label: 'Regular', color: 'text-blue-600' },
  { value: 4, label: 'Low', color: 'text-muted-foreground' },
];

function getNextScheduledDate(def: TaskDefinition): string {
  const today = new Date();
  const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay(); // Convert Sunday from 0 to 7

  switch (def.frequency) {
    case 'daily':
    case 'twice_daily':
      return 'Today';
    case 'twice_weekly':
    case 'weekly':
      if (def.frequency_days && def.frequency_days.length > 0) {
        // Find next matching day
        for (let i = 0; i < 7; i++) {
          const checkDay = ((dayOfWeek - 1 + i) % 7) + 1;
          if (def.frequency_days.includes(checkDay)) {
            if (i === 0) return 'Today';
            if (i === 1) return 'Tomorrow';
            const nextDate = new Date(today);
            nextDate.setDate(today.getDate() + i);
            return nextDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
          }
        }
      }
      return 'Not scheduled';
    case 'monthly':
      if (today.getDate() === 1) return 'Today';
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      return nextMonth.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    case 'quarterly':
      const quarterMonths = [0, 3, 6, 9]; // Jan, Apr, Jul, Oct
      const currentMonth = today.getMonth();
      const nextQuarter = quarterMonths.find(m => m > currentMonth) ?? quarterMonths[0];
      const nextQuarterDate = new Date(
        nextQuarter <= currentMonth ? today.getFullYear() + 1 : today.getFullYear(),
        nextQuarter,
        1
      );
      return nextQuarterDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    case 'biannual':
      const biannualMonths = [0, 6]; // Jan, Jul
      const currentMo = today.getMonth();
      const nextBiannual = biannualMonths.find(m => m > currentMo) ?? biannualMonths[0];
      const nextBiannualDate = new Date(
        nextBiannual <= currentMo ? today.getFullYear() + 1 : today.getFullYear(),
        nextBiannual,
        1
      );
      return nextBiannualDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    case 'adhoc':
      return 'Manual';
    default:
      return 'Unknown';
  }
}

function TaskDefinitionRow({
  definition,
  onEdit,
  onToggle,
  onDelete,
  isUpdating,
}: {
  definition: TaskDefinition;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  isUpdating: boolean;
}) {
  const priorityOption = PRIORITY_OPTIONS.find(p => p.value === definition.priority);
  const nextScheduled = getNextScheduledDate(definition);

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border transition-colors',
        !definition.is_active && 'opacity-50 bg-muted/30'
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{definition.name}</span>
          {definition.is_system && (
            <Badge variant="secondary" className="text-xs">System</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          <span className="flex items-center gap-1">
            <CalendarIcon className="h-3 w-3" />
            {FREQUENCY_LABELS[definition.frequency]}
          </span>
          {definition.estimated_minutes && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {definition.estimated_minutes}m
            </span>
          )}
          <span className={priorityOption?.color}>
            {priorityOption?.label}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Next: {nextScheduled}</span>
      </div>

      <div className="flex items-center gap-1">
        <Switch
          checked={definition.is_active}
          onCheckedChange={onToggle}
          disabled={isUpdating}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        {!definition.is_system && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

interface EditFormData {
  name: string;
  description: string;
  category: string;
  frequency: TaskDefinition['frequency'];
  frequency_days: number[];
  ideal_time: 'AM' | 'PM' | 'ANY';
  priority: number;
  estimated_minutes: number | null;
  deep_link_url: string;
  is_active: boolean;
}

function TaskDefinitionForm({
  definition,
  onSave,
  onCancel,
  isSaving,
}: {
  definition: TaskDefinition | null;
  onSave: (data: EditFormData) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const isNew = !definition;
  const [formData, setFormData] = useState<EditFormData>({
    name: definition?.name ?? '',
    description: definition?.description ?? '',
    category: definition?.category ?? 'Admin',
    frequency: definition?.frequency ?? 'daily',
    frequency_days: definition?.frequency_days ?? [],
    ideal_time: definition?.ideal_time ?? 'ANY',
    priority: definition?.priority ?? 3,
    estimated_minutes: definition?.estimated_minutes ?? null,
    deep_link_url: definition?.deep_link_url ?? '',
    is_active: definition?.is_active ?? true,
  });

  const showDaysSelector = formData.frequency === 'twice_weekly' || formData.frequency === 'weekly';

  const toggleDay = (day: number) => {
    setFormData(prev => ({
      ...prev,
      frequency_days: prev.frequency_days.includes(day)
        ? prev.frequency_days.filter(d => d !== day)
        : [...prev.frequency_days, day].sort((a, b) => a - b),
    }));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Task Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
          placeholder="e.g., Process orders"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="What this task involves..."
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Category</Label>
          <Select
            value={formData.category}
            onValueChange={(value: string) => setFormData(prev => ({ ...prev, category: value }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Priority</Label>
          <Select
            value={String(formData.priority)}
            onValueChange={(value: string) => setFormData(prev => ({ ...prev, priority: parseInt(value) }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  <span className={opt.color}>{opt.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Frequency</Label>
          <Select
            value={formData.frequency}
            onValueChange={(value: string) => setFormData(prev => ({
              ...prev,
              frequency: value as TaskDefinition['frequency'],
              frequency_days: value === 'twice_weekly' || value === 'weekly' ? prev.frequency_days : [],
            }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Preferred Time</Label>
          <Select
            value={formData.ideal_time}
            onValueChange={(value: string) => setFormData(prev => ({ ...prev, ideal_time: value as 'AM' | 'PM' | 'ANY' }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AM">Morning</SelectItem>
              <SelectItem value="PM">Afternoon</SelectItem>
              <SelectItem value="ANY">Any time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {showDaysSelector && (
        <div className="space-y-2">
          <Label>Days of Week</Label>
          <div className="flex gap-1">
            {DAY_OPTIONS.map(day => (
              <Button
                key={day.value}
                type="button"
                variant={formData.frequency_days.includes(day.value) ? 'default' : 'outline'}
                size="sm"
                className="w-10"
                onClick={() => toggleDay(day.value)}
              >
                {day.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="estimated_minutes">Est. Duration (minutes)</Label>
          <Input
            id="estimated_minutes"
            type="number"
            min="1"
            value={formData.estimated_minutes ?? ''}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              estimated_minutes: e.target.value ? parseInt(e.target.value) : null
            }))}
            placeholder="e.g., 30"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="deep_link_url">Link URL</Label>
          <Input
            id="deep_link_url"
            value={formData.deep_link_url}
            onChange={(e) => setFormData(prev => ({ ...prev, deep_link_url: e.target.value }))}
            placeholder="/orders"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={formData.is_active}
          onCheckedChange={(checked: boolean) => setFormData(prev => ({ ...prev, is_active: checked }))}
        />
        <Label>Active</Label>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={() => onSave(formData)} disabled={isSaving || !formData.name.trim()}>
          {isSaving ? 'Saving...' : isNew ? 'Create Task' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// FUTURE CUSTOM TASKS COMPONENTS
// ============================================================================

function FutureTaskRow({
  task,
  onEdit,
  onDelete,
  isDeleting,
}: {
  task: FutureTask;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const priorityOption = PRIORITY_OPTIONS.find(p => p.value === task.priority);
  const scheduledDate = parseISO(task.scheduledDate);
  const formattedDate = format(scheduledDate, 'EEE, d MMM yyyy');

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{task.name}</span>
          <Badge variant="outline" className="text-xs">Custom</Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3 w-3" />
            {formattedDate}
          </span>
          {task.estimatedMinutes && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {task.estimatedMinutes}m
            </span>
          )}
          <span className={priorityOption?.color}>
            {priorityOption?.label}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={isDeleting}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

interface FutureTaskFormData {
  name: string;
  description: string;
  category: string;
  priority: number;
  estimated_minutes: number | null;
  scheduled_date: Date;
}

function FutureTaskForm({
  task,
  onSave,
  onCancel,
  isSaving,
}: {
  task: FutureTask;
  onSave: (data: FutureTaskFormData) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [formData, setFormData] = useState<FutureTaskFormData>({
    name: task.name,
    description: task.description ?? '',
    category: task.category,
    priority: task.priority,
    estimated_minutes: task.estimatedMinutes,
    scheduled_date: parseISO(task.scheduledDate),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="ft-name">Task Name *</Label>
        <Input
          id="ft-name"
          value={formData.name}
          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
          placeholder="e.g., Call supplier"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ft-description">Description</Label>
        <Textarea
          id="ft-description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Additional details..."
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Category</Label>
          <Select
            value={formData.category}
            onValueChange={(value: string) => setFormData(prev => ({ ...prev, category: value }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Priority</Label>
          <Select
            value={String(formData.priority)}
            onValueChange={(value: string) => setFormData(prev => ({ ...prev, priority: parseInt(value) }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  <span className={opt.color}>{opt.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="ft-estimated">Est. Duration (minutes)</Label>
          <Input
            id="ft-estimated"
            type="number"
            min="1"
            value={formData.estimated_minutes ?? ''}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              estimated_minutes: e.target.value ? parseInt(e.target.value) : null
            }))}
            placeholder="e.g., 30"
          />
        </div>

        <div className="space-y-2">
          <Label>Due Date *</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-start text-left font-normal"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(formData.scheduled_date, 'dd MMM yyyy')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={formData.scheduled_date}
                onSelect={(date) => date && setFormData(prev => ({ ...prev, scheduled_date: date }))}
                disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={() => onSave(formData)} disabled={isSaving || !formData.name.trim()}>
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}

export function TaskDefinitionsDialog({ open, onOpenChange }: TaskDefinitionsDialogProps) {
  const { toast } = useToast();
  const { data, isLoading, error } = useTaskDefinitions();
  const updateDefinition = useUpdateDefinition();
  const createDefinition = useCreateDefinition();
  const deleteDefinition = useDeleteDefinition();

  // Future custom tasks
  const { data: futureTasksData, isLoading: futureTasksLoading } = useFutureTasks();
  const updateFutureTask = useUpdateFutureTask();
  const deleteFutureTask = useDeleteFutureTask();

  const [editingDefinition, setEditingDefinition] = useState<TaskDefinition | null>(null);
  const [editingFutureTask, setEditingFutureTask] = useState<FutureTask | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const definitions = data?.definitions ?? [];
  const futureTasks = futureTasksData?.tasks ?? [];

  // Group definitions by category
  const groupedDefinitions = definitions.reduce((acc, def) => {
    const category = def.category || 'Other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(def);
    return acc;
  }, {} as Record<string, TaskDefinition[]>);

  const handleToggleActive = async (def: TaskDefinition) => {
    try {
      await updateDefinition.mutateAsync({
        id: def.id,
        data: { is_active: !def.is_active },
      });
      toast({
        title: def.is_active ? 'Task disabled' : 'Task enabled',
        description: `${def.name} will ${def.is_active ? 'no longer' : 'now'} appear in your task queue.`,
      });
    } catch {
      toast({
        title: 'Failed to update task',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (def: TaskDefinition) => {
    if (!confirm(`Are you sure you want to delete "${def.name}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteDefinition.mutateAsync(def.id);
      toast({
        title: 'Task deleted',
        description: `${def.name} has been removed.`,
      });
    } catch (err) {
      toast({
        title: 'Failed to delete task',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleSave = async (formData: EditFormData) => {
    try {
      if (editingDefinition) {
        await updateDefinition.mutateAsync({
          id: editingDefinition.id,
          data: {
            name: formData.name,
            description: formData.description || null,
            category: formData.category,
            frequency: formData.frequency,
            frequency_days: formData.frequency_days.length > 0 ? formData.frequency_days : null,
            ideal_time: formData.ideal_time,
            priority: formData.priority,
            estimated_minutes: formData.estimated_minutes,
            deep_link_url: formData.deep_link_url || null,
            is_active: formData.is_active,
          },
        });
        toast({ title: 'Task updated' });
      } else {
        await createDefinition.mutateAsync({
          name: formData.name,
          description: formData.description || null,
          category: formData.category,
          frequency: formData.frequency,
          frequency_days: formData.frequency_days.length > 0 ? formData.frequency_days : null,
          ideal_time: formData.ideal_time,
          priority: formData.priority,
          estimated_minutes: formData.estimated_minutes,
          deep_link_url: formData.deep_link_url || null,
          is_active: formData.is_active,
          icon: null,
          count_source: null,
        });
        toast({ title: 'Task created' });
      }
      setEditingDefinition(null);
      setIsCreating(false);
    } catch {
      toast({
        title: 'Failed to save task',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteFutureTask = async (task: FutureTask) => {
    if (!confirm(`Are you sure you want to delete "${task.name}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteFutureTask.mutateAsync(task.id);
      toast({
        title: 'Task deleted',
        description: `${task.name} has been removed.`,
      });
    } catch (err) {
      toast({
        title: 'Failed to delete task',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleSaveFutureTask = async (formData: FutureTaskFormData) => {
    if (!editingFutureTask) return;

    try {
      await updateFutureTask.mutateAsync({
        id: editingFutureTask.id,
        data: {
          name: formData.name,
          description: formData.description || null,
          category: formData.category,
          priority: formData.priority,
          estimatedMinutes: formData.estimated_minutes,
          scheduledDate: format(formData.scheduled_date, 'yyyy-MM-dd'),
        },
      });
      toast({ title: 'Task updated' });
      setEditingFutureTask(null);
    } catch {
      toast({
        title: 'Failed to save task',
        variant: 'destructive',
      });
    }
  };

  const isEditing = editingDefinition !== null || isCreating;
  const isEditingFutureTask = editingFutureTask !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Task Queue Configuration
          </DialogTitle>
          <DialogDescription>
            Manage your recurring tasks, schedules, and priorities.
          </DialogDescription>
        </DialogHeader>

        {isEditingFutureTask ? (
          <FutureTaskForm
            task={editingFutureTask}
            onSave={handleSaveFutureTask}
            onCancel={() => setEditingFutureTask(null)}
            isSaving={updateFutureTask.isPending}
          />
        ) : isEditing ? (
          <TaskDefinitionForm
            definition={editingDefinition}
            onSave={handleSave}
            onCancel={() => {
              setEditingDefinition(null);
              setIsCreating(false);
            }}
            isSaving={updateDefinition.isPending || createDefinition.isPending}
          />
        ) : (
          <>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setIsCreating(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add Task
              </Button>
            </div>

            {isLoading || futureTasksLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Failed to load task definitions. Please try again.
                </AlertDescription>
              </Alert>
            ) : definitions.length === 0 && futureTasks.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No tasks configured yet.</p>
                <Button variant="link" onClick={() => setIsCreating(true)}>
                  Create your first task
                </Button>
              </div>
            ) : (
              <ScrollArea className="h-[400px] pr-4">
                <Accordion
                  type="multiple"
                  defaultValue={[...Object.keys(groupedDefinitions), ...(futureTasks.length > 0 ? ['__future__'] : [])]}
                  className="space-y-2"
                >
                  {Object.entries(groupedDefinitions).map(([category, defs]) => (
                    <AccordionItem key={category} value={category} className="border rounded-lg px-3">
                      <AccordionTrigger className="hover:no-underline py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{category}</span>
                          <Badge variant="secondary" className="text-xs">
                            {defs.filter(d => d.is_active).length}/{defs.length}
                          </Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-2 pb-3">
                        {defs.map(def => (
                          <TaskDefinitionRow
                            key={def.id}
                            definition={def}
                            onEdit={() => setEditingDefinition(def)}
                            onToggle={() => handleToggleActive(def)}
                            onDelete={() => handleDelete(def)}
                            isUpdating={updateDefinition.isPending}
                          />
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  ))}

                  {futureTasks.length > 0 && (
                    <AccordionItem value="__future__" className="border rounded-lg px-3 border-dashed">
                      <AccordionTrigger className="hover:no-underline py-3">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">Custom Future Tasks</span>
                          <Badge variant="outline" className="text-xs">
                            {futureTasks.length}
                          </Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-2 pb-3">
                        <p className="text-xs text-muted-foreground mb-2">
                          One-time tasks scheduled for future dates
                        </p>
                        {futureTasks.map(task => (
                          <FutureTaskRow
                            key={task.id}
                            task={task}
                            onEdit={() => setEditingFutureTask(task)}
                            onDelete={() => handleDeleteFutureTask(task)}
                            isDeleting={deleteFutureTask.isPending}
                          />
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  )}
                </Accordion>
              </ScrollArea>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
