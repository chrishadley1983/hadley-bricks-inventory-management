'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Pencil, Check, X, Eye } from 'lucide-react';
import { RichTextEditor } from '@/components/features/listing-assistant/shared/RichTextEditor';
import { sanitizeHtml } from './utils';

interface DescriptionEditorProps {
  value: string;
  onSave: (html: string) => void;
  isUpdating?: boolean;
  label?: string;
  richText?: boolean;
}

export function DescriptionEditor({
  value,
  onSave,
  isUpdating,
  label = 'Description',
  richText = true,
}: DescriptionEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const handleStartEdit = () => {
    setEditValue(value);
    setIsEditing(true);
  };

  const handleSave = () => {
    onSave(editValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
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
        {richText ? (
          <RichTextEditor
            value={editValue}
            onChange={setEditValue}
            className="min-h-[200px]"
            placeholder="Enter description..."
          />
        ) : (
          <Textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="min-h-[100px] text-sm"
            autoFocus
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
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
      {value ? (
        richText ? (
          <div
            className="prose prose-sm max-w-none text-sm rounded-lg border bg-muted/30 p-4 [&_p]:my-1 [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }}
          />
        ) : (
          <div className="text-sm rounded-lg border bg-muted/30 p-4 whitespace-pre-wrap">
            {value}
          </div>
        )
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground italic rounded-lg border bg-muted/30 p-4">
          <Eye className="h-4 w-4" />
          No {label.toLowerCase()} yet
        </div>
      )}
    </div>
  );
}
