'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';

interface AspectEditorProps {
  aspects: Record<string, string[]>;
  onSave: (aspects: Record<string, string[]>) => void;
  isUpdating?: boolean;
}

interface AspectRow {
  key: string;
  value: string;
}

function aspectsToRows(aspects: Record<string, string[]>): AspectRow[] {
  return Object.entries(aspects).map(([key, values]) => ({
    key,
    value: values.join(', '),
  }));
}

function rowsToAspects(rows: AspectRow[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const row of rows) {
    if (row.key.trim()) {
      result[row.key.trim()] = row.value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }
  }
  return result;
}

export function AspectEditor({ aspects, onSave, isUpdating }: AspectEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [rows, setRows] = useState<AspectRow[]>([]);

  const handleStartEdit = () => {
    setRows(aspectsToRows(aspects));
    setIsEditing(true);
  };

  const handleSave = () => {
    onSave(rowsToAspects(rows));
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleAddRow = () => {
    setRows([...rows, { key: '', value: '' }]);
  };

  const handleDeleteRow = (index: number) => {
    setRows(rows.filter((_, i) => i !== index));
  };

  const handleChange = (index: number, field: 'key' | 'value', val: string) => {
    setRows(rows.map((r, i) => (i === index ? { ...r, [field]: val } : r)));
  };

  const entries = Object.entries(aspects);

  if (isEditing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Item Specifics</span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={handleSave}
              disabled={isUpdating}
            >
              <Check className="h-3.5 w-3.5 mr-1" /> Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleCancel}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={row.key}
                onChange={(e) => handleChange(i, 'key', e.target.value)}
                placeholder="Key"
                className="h-8 text-xs flex-[2]"
              />
              <Input
                value={row.value}
                onChange={(e) => handleChange(i, 'value', e.target.value)}
                placeholder="Value"
                className="h-8 text-xs flex-[3]"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => handleDeleteRow(i)}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={handleAddRow}>
          <Plus className="h-3 w-3 mr-1" /> Add Row
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Item Specifics</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={handleStartEdit}
          disabled={isUpdating}
        >
          <Pencil className="h-3 w-3 mr-1" /> Edit
        </Button>
      </div>
      {entries.length > 0 ? (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <tbody>
              {entries.map(([key, values]) => (
                <tr key={key} className="border-b last:border-b-0">
                  <td className="px-3 py-1.5 font-medium bg-muted/30 w-2/5">{key}</td>
                  <td className="px-3 py-1.5">{values.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">No item specifics</p>
      )}
    </div>
  );
}
