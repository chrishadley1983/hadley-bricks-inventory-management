'use client';

import { useState } from 'react';
import { format } from 'date-fns';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Loader2, CalendarIcon } from 'lucide-react';
import { useCreateTask } from '@/hooks/use-workflow';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface QuickAddTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const categories = ['Shipping', 'Listing', 'Sourcing', 'Admin', 'Development', 'Other'];

const priorities = [
  { value: '1', label: 'Critical', color: 'text-red-500' },
  { value: '2', label: 'Important', color: 'text-amber-500' },
  { value: '3', label: 'Regular', color: 'text-blue-500' },
  { value: '4', label: 'Low', color: 'text-gray-500' },
];

export function QuickAddTaskDialog({ open, onOpenChange }: QuickAddTaskDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Other');
  const [priority, setPriority] = useState('3');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);

  const createTask = useCreateTask();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({ title: 'Please enter a task name', variant: 'destructive' });
      return;
    }

    try {
      await createTask.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        priority: parseInt(priority, 10),
        estimatedMinutes: estimatedMinutes ? parseInt(estimatedMinutes, 10) : undefined,
        scheduledDate: dueDate ? format(dueDate, 'yyyy-MM-dd') : undefined,
      });

      toast({ title: 'Task added' });
      onOpenChange(false);
      resetForm();
    } catch {
      toast({ title: 'Failed to add task', variant: 'destructive' });
    }
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setCategory('Other');
    setPriority('3');
    setEstimatedMinutes('');
    setDueDate(undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Task</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Post parcels"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Additional details..."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="priority">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger id="priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {priorities.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        <span className={p.color}>{p.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="estimatedMinutes">Estimated time (mins)</Label>
                <Input
                  id="estimatedMinutes"
                  type="number"
                  min="1"
                  max="480"
                  value={estimatedMinutes}
                  onChange={(e) => setEstimatedMinutes(e.target.value)}
                  placeholder="30"
                />
              </div>

              <div className="grid gap-2">
                <Label>Due date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'justify-start text-left font-normal',
                        !dueDate && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dueDate ? format(dueDate, 'dd MMM yyyy') : 'Today'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dueDate}
                      onSelect={setDueDate}
                      disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createTask.isPending}>
              {createTask.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
