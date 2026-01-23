'use client';

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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useMtdExportPreview } from '@/hooks/use-mtd-export';

interface ExportConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startMonth: string;
  endMonth: string;
  onConfirm: () => Promise<void>;
  isExporting?: boolean;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPeriodLabel(startMonth: string, endMonth: string): string {
  const startDate = new Date(startMonth + '-01');
  const endDate = new Date(endMonth + '-01');

  const startLabel = startDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const endLabel = endDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  if (startMonth === endMonth) {
    return startLabel;
  }
  return `${startLabel} to ${endLabel}`;
}

export function ExportConfirmDialog({
  open,
  onOpenChange,
  startMonth,
  endMonth,
  onConfirm,
  isExporting = false,
}: ExportConfirmDialogProps) {
  const { data: preview, isLoading } = useMtdExportPreview(
    open ? startMonth : undefined,
    open ? endMonth : undefined
  );

  const handleConfirm = async () => {
    await onConfirm();
  };

  const periodLabel = formatPeriodLabel(startMonth, endMonth);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Export to QuickFile</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : preview ? (
                <>
                  <p>
                    Export <strong>{periodLabel}</strong> to QuickFile?
                  </p>

                  <div className="rounded-md border p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sales:</span>
                      <span>
                        {preview.salesCount} {preview.salesCount === 1 ? 'entry' : 'entries'} (
                        {formatCurrency(preview.salesTotal)})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expenses:</span>
                      <span>
                        {preview.expensesCount} {preview.expensesCount === 1 ? 'entry' : 'entries'} (
                        {formatCurrency(preview.expensesTotal)})
                      </span>
                    </div>
                  </div>

                  {preview.previousExport && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        This period was already exported to QuickFile on{' '}
                        {formatDate(preview.previousExport.exportedAt)}. Export again?
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              ) : (
                <p>Unable to load export preview.</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isExporting}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isExporting || isLoading}>
            {isExporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {preview?.previousExport ? 'Export Again' : 'Export'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
