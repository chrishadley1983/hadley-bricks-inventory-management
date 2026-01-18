'use client';

/**
 * Draft Restoration Dialog Component
 * F48: Prompts user to restore or discard draft on load
 */

import { format } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface DraftRestorationDialogProps {
  open: boolean;
  draftTime: string | null;
  onRestore: () => void;
  onDiscard: () => void;
}

export function DraftRestorationDialog({
  open,
  draftTime,
  onRestore,
  onDiscard,
}: DraftRestorationDialogProps) {
  const formattedTime = draftTime
    ? format(new Date(draftTime), 'MMM d, yyyy h:mm a')
    : 'Unknown';

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved Draft Found</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes from {formattedTime}. Would you like to restore
            this draft or discard it?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDiscard}>Discard</AlertDialogCancel>
          <AlertDialogAction onClick={onRestore}>Restore Draft</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
