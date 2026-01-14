'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Heading2,
  Heading3,
  Pilcrow,
  RemoveFormatting,
  Code,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  className?: string;
  placeholder?: string;
  showSourceToggle?: boolean;
}

/**
 * Save the current cursor/selection position
 */
function saveSelection(): Range | null {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    return selection.getRangeAt(0).cloneRange();
  }
  return null;
}

/**
 * Restore a previously saved cursor/selection position
 */
function restoreSelection(range: Range | null) {
  if (range) {
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
}

export function RichTextEditor({
  value,
  onChange,
  className,
  placeholder = 'Enter content...',
  showSourceToggle = true,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);
  const [isSourceView, setIsSourceView] = useState(false);

  // Sync external value changes to the editor (only when not from internal edits)
  useEffect(() => {
    if (editorRef.current && !isInternalChange.current) {
      // Only update if the content actually differs
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value;
      }
    }
    isInternalChange.current = false;
  }, [value]);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const execCommand = useCallback((command: string, cmdValue?: string) => {
    // Save selection before command
    const savedRange = saveSelection();

    document.execCommand(command, false, cmdValue);

    // Restore selection after command
    restoreSelection(savedRange);
    editorRef.current?.focus();
    handleInput();
  }, [handleInput]);

  const formatBlock = useCallback((tag: string) => {
    const savedRange = saveSelection();

    document.execCommand('formatBlock', false, tag);

    restoreSelection(savedRange);
    editorRef.current?.focus();
    handleInput();
  }, [handleInput]);

  const handleSourceChange = useCallback((html: string) => {
    onChange(html);
  }, [onChange]);

  // Source view
  if (isSourceView) {
    return (
      <div className={cn('rounded-md border bg-background', className)}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-1 border-b p-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Code className="h-4 w-4" />
            HTML Source
          </div>
          {showSourceToggle && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSourceView(false)}
              title="Visual Editor"
            >
              <Eye className="h-4 w-4 mr-1" />
              Visual
            </Button>
          )}
        </div>
        <textarea
          value={value}
          onChange={(e) => handleSourceChange(e.target.value)}
          className="w-full min-h-[200px] p-4 bg-transparent font-mono text-sm resize-y focus:outline-none"
          spellCheck={false}
          placeholder="<p>Enter HTML here...</p>"
        />
      </div>
    );
  }

  // Visual editor view
  return (
    <div className={cn('rounded-md border bg-background', className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b p-2">
        <Toggle
          size="sm"
          onPressedChange={() => execCommand('bold')}
          aria-label="Bold"
        >
          <Bold className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          onPressedChange={() => execCommand('italic')}
          aria-label="Italic"
        >
          <Italic className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          onPressedChange={() => execCommand('underline')}
          aria-label="Underline"
        >
          <Underline className="h-4 w-4" />
        </Toggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Toggle
          size="sm"
          onPressedChange={() => formatBlock('h2')}
          aria-label="Heading 2"
        >
          <Heading2 className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          onPressedChange={() => formatBlock('h3')}
          aria-label="Heading 3"
        >
          <Heading3 className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          onPressedChange={() => formatBlock('p')}
          aria-label="Paragraph"
        >
          <Pilcrow className="h-4 w-4" />
        </Toggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Toggle
          size="sm"
          onPressedChange={() => execCommand('insertUnorderedList')}
          aria-label="Bullet List"
        >
          <List className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          onPressedChange={() => execCommand('insertOrderedList')}
          aria-label="Numbered List"
        >
          <ListOrdered className="h-4 w-4" />
        </Toggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Button
          variant="ghost"
          size="sm"
          onClick={() => execCommand('removeFormat')}
          title="Clear Formatting"
        >
          <RemoveFormatting className="h-4 w-4" />
        </Button>

        {showSourceToggle && (
          <>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSourceView(true)}
              title="HTML Source"
            >
              <Code className="h-4 w-4 mr-1" />
              HTML
            </Button>
          </>
        )}
      </div>

      {/* Editor Area */}
      <div
        ref={editorRef}
        contentEditable
        className={cn(
          'min-h-[200px] p-4 focus:outline-none',
          'prose prose-sm max-w-none',
          '[&_p]:my-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-medium',
          '[&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4',
          '[&_hr]:my-4 [&_hr]:border-muted-foreground/20',
          'empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground'
        )}
        data-placeholder={placeholder}
        onInput={handleInput}
      />
    </div>
  );
}

/**
 * Simple HTML source code viewer/editor (standalone version)
 */
export function HtmlSourceEditor({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('rounded-md border bg-muted/50', className)}>
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm text-muted-foreground">
        <Code className="h-4 w-4" />
        HTML Source
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-h-[200px] p-4 bg-transparent font-mono text-sm resize-y focus:outline-none"
        spellCheck={false}
      />
    </div>
  );
}
