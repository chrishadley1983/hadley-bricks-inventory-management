'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { SyncStreamState } from '@/types/minifig-sync-stream';
import { SYNC_OPERATION_LABELS } from '@/types/minifig-sync-stream';

interface SyncProgressDialogProps {
  open: boolean;
  onClose: () => void;
  stream: SyncStreamState;
}

function ResultSummary({ result }: { result: Record<string, unknown> }) {
  // Build summary lines from the result data
  const lines: Array<{ label: string; value: unknown }> = [];

  if ('itemsProcessed' in result) lines.push({ label: 'Processed', value: result.itemsProcessed });
  if ('itemsCreated' in result) lines.push({ label: 'Created', value: result.itemsCreated });
  if ('itemsUpdated' in result) lines.push({ label: 'Updated', value: result.itemsUpdated });
  if ('itemsResearched' in result) lines.push({ label: 'Researched', value: result.itemsResearched });
  if ('itemsCached' in result) lines.push({ label: 'From cache', value: result.itemsCached });
  if ('itemsStaged' in result) lines.push({ label: 'Staged', value: result.itemsStaged });
  if ('itemsSkipped' in result) lines.push({ label: 'Skipped', value: result.itemsSkipped });
  if ('itemsErrored' in result) lines.push({ label: 'Errors', value: result.itemsErrored });

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {lines.map(({ label, value }) => (
        <div key={label} className="contents">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium">{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function SyncProgressDialog({ open, onClose, stream }: SyncProgressDialogProps) {
  const isStreaming = stream.status === 'streaming';
  const isComplete = stream.status === 'complete';
  const isError = stream.status === 'error';
  const title = stream.operation ? SYNC_OPERATION_LABELS[stream.operation] : 'Sync';
  const progressPercent = stream.total > 0 ? Math.round((stream.current / stream.total) * 100) : 0;

  // Elapsed time counter
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isStreaming) {
      setElapsed(0);
      intervalRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isStreaming]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v: boolean) => {
        // Only allow closing when not streaming
        if (!v && !isStreaming) onClose();
      }}
    >
      <DialogContent
        onPointerDownOutside={(e: Event) => { if (isStreaming) e.preventDefault(); }}
        onEscapeKeyDown={(e: KeyboardEvent) => { if (isStreaming) e.preventDefault(); }}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isStreaming && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
            {isComplete && <CheckCircle2 className="h-5 w-5 text-green-500" />}
            {isError && <AlertCircle className="h-5 w-5 text-destructive" />}
            {title}
          </DialogTitle>
          <DialogDescription>
            {isStreaming && 'Operation in progress...'}
            {isComplete && 'Operation completed successfully.'}
            {isError && 'Operation failed.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Stage message with elapsed time */}
          {isStreaming && stream.stageMessage && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{stream.stageMessage}</p>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatElapsed(elapsed)}
              </span>
            </div>
          )}

          {/* Progress bar (only when we have a total) */}
          {isStreaming && stream.total > 0 && (
            <div className="space-y-2">
              <Progress value={progressPercent} />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{stream.itemMessage}</span>
                <span>
                  {stream.current} / {stream.total}
                </span>
              </div>
            </div>
          )}

          {/* Complete: show result summary with elapsed time */}
          {isComplete && stream.result && (
            <div className="space-y-2">
              <ResultSummary result={stream.result} />
              <p className="text-xs text-muted-foreground">
                Completed in {formatElapsed(elapsed)}
              </p>
            </div>
          )}

          {/* Error message */}
          {isError && stream.error && (
            <p className="text-sm text-destructive">{stream.error}</p>
          )}
        </div>

        {/* Footer with close button (only when not streaming) */}
        {!isStreaming && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
