'use client';

import * as React from 'react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type EditableCellType = 'text' | 'number' | 'currency' | 'date' | 'select';

export interface SelectOption {
  value: string;
  label: string;
}

interface EditableCellProps {
  value: string | number | null | undefined;
  displayValue?: React.ReactNode;
  type?: EditableCellType;
  options?: SelectOption[];
  onSave: (value: string | number | null) => Promise<void>;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function EditableCell({
  value,
  displayValue,
  type = 'text',
  options = [],
  onSave,
  className,
  placeholder = '-',
  disabled = false,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize edit value when entering edit mode
  useEffect(() => {
    if (isEditing) {
      if (type === 'currency' && value != null) {
        // Strip currency formatting for editing
        setEditValue(String(value));
      } else if (type === 'date' && value) {
        // Ensure date is in YYYY-MM-DD format
        setEditValue(String(value).split('T')[0]);
      } else {
        setEditValue(value != null ? String(value) : '');
      }
    }
  }, [isEditing, value, type]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current && type !== 'select') {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing, type]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      let finalValue: string | number | null = editValue.trim() || null;

      if (type === 'number' || type === 'currency') {
        finalValue = editValue ? parseFloat(editValue) : null;
        if (finalValue !== null && isNaN(finalValue)) {
          finalValue = null;
        }
      }

      await onSave(finalValue);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  }, [editValue, onSave, type]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditValue('');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleSave, handleCancel]
  );

  const handleSelectChange = useCallback(
    async (newValue: string) => {
      setIsSaving(true);
      try {
        await onSave(newValue || null);
        setIsEditing(false);
      } catch (error) {
        console.error('Failed to save:', error);
      } finally {
        setIsSaving(false);
      }
    },
    [onSave]
  );

  // Click outside to cancel
  useEffect(() => {
    if (!isEditing) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleCancel();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEditing, handleCancel]);

  if (disabled) {
    return <span className={className}>{displayValue ?? placeholder}</span>;
  }

  if (!isEditing) {
    return (
      <span
        className={cn(
          'cursor-pointer rounded px-1 -mx-1 hover:bg-muted/50 transition-colors',
          className
        )}
        onClick={() => setIsEditing(true)}
        title="Click to edit"
      >
        {displayValue ?? (value != null ? String(value) : placeholder)}
      </span>
    );
  }

  if (type === 'select') {
    return (
      <div ref={containerRef} className="flex items-center gap-1">
        <Select
          value={editValue || (value as string) || ''}
          onValueChange={handleSelectChange}
          disabled={isSaving}
        >
          <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleCancel}
          disabled={isSaving}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex items-center gap-1">
      <Input
        ref={inputRef}
        type={
          type === 'date' ? 'date' : type === 'number' || type === 'currency' ? 'number' : 'text'
        }
        step={type === 'currency' ? '0.01' : undefined}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="h-7 w-auto min-w-[80px] text-xs"
        disabled={isSaving}
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-green-600 hover:text-green-700 hover:bg-green-50"
        onClick={handleSave}
        disabled={isSaving}
      >
        {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-red-600 hover:text-red-700 hover:bg-red-50"
        onClick={handleCancel}
        disabled={isSaving}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
