'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { FileText, Download, Upload, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuickFileCredentials } from '@/hooks/use-quickfile-credentials';
import { useMtdExportCsv, useMtdExportQuickFile } from '@/hooks/use-mtd-export';
import { QuickFileCredentialsModal } from './QuickFileCredentialsModal';
import { ExportConfirmDialog } from './ExportConfirmDialog';
import { PeriodSelectDialog } from './PeriodSelectDialog';

interface MtdExportDropdownProps {
  disabled?: boolean;
}

export function MtdExportDropdown({ disabled }: MtdExportDropdownProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showPeriodDialog, setShowPeriodDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<'csv' | 'quickfile' | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<{
    startMonth: string;
    endMonth: string;
  } | null>(null);

  const { data: credentials } = useQuickFileCredentials();
  const exportCsv = useMtdExportCsv();
  const pushToQuickFile = useMtdExportQuickFile();

  const handleCsvClick = () => {
    setPendingAction('csv');
    setShowPeriodDialog(true);
  };

  const handleQuickFileClick = () => {
    setPendingAction('quickfile');
    setShowPeriodDialog(true);
  };

  const handlePeriodConfirm = (startMonth: string, endMonth: string) => {
    setSelectedPeriod({ startMonth, endMonth });
    setShowPeriodDialog(false);

    if (pendingAction === 'csv') {
      handleCsvDownload(startMonth, endMonth);
    } else if (pendingAction === 'quickfile') {
      if (!credentials?.configured) {
        setShowCredentialsModal(true);
      } else {
        setShowConfirmDialog(true);
      }
    }
  };

  const handleCsvDownload = async (startMonth: string, endMonth: string) => {
    setIsExporting(true);
    try {
      await exportCsv.mutateAsync({ startMonth, endMonth });
      toast.success('CSV downloaded successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download CSV';
      if (message.includes('No data')) {
        toast.error(message);
      } else {
        toast.error(`Export failed: ${message}`);
      }
    } finally {
      setIsExporting(false);
      setPendingAction(null);
    }
  };

  const handleConfirmExport = async () => {
    if (!selectedPeriod) return;

    setIsExporting(true);
    try {
      const result = await pushToQuickFile.mutateAsync({
        startMonth: selectedPeriod.startMonth,
        endMonth: selectedPeriod.endMonth,
      });
      toast.success(
        `Exported ${result.invoicesCreated} invoices and ${result.purchasesCreated} purchases to QuickFile`
      );
      setShowConfirmDialog(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to push to QuickFile';

      if (message === 'NEEDS_CREDENTIALS') {
        setShowConfirmDialog(false);
        setShowCredentialsModal(true);
      } else if (message.includes('No data')) {
        toast.error(message);
        setShowConfirmDialog(false);
      } else {
        toast.error(message);
      }
    } finally {
      setIsExporting(false);
      setPendingAction(null);
    }
  };

  const handleCredentialsSuccess = () => {
    // After credentials saved, open the confirm dialog
    setShowConfirmDialog(true);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled || isExporting}
            data-testid="mtd-export-dropdown"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <FileText className="h-4 w-4 mr-2" />
            )}
            Export for MTD
            <ChevronDown className="h-4 w-4 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleCsvClick} disabled={isExporting}>
            <Download className="h-4 w-4 mr-2" />
            Download CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleQuickFileClick} disabled={isExporting}>
            <Upload className="h-4 w-4 mr-2" />
            Push to QuickFile
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PeriodSelectDialog
        open={showPeriodDialog}
        onOpenChange={(open) => {
          setShowPeriodDialog(open);
          if (!open) setPendingAction(null);
        }}
        onConfirm={handlePeriodConfirm}
        title={pendingAction === 'csv' ? 'Select Export Period' : 'Select Period for QuickFile'}
        description={
          pendingAction === 'csv'
            ? 'Choose the date range for your MTD CSV export.'
            : 'Choose the date range to export to QuickFile.'
        }
      />

      <QuickFileCredentialsModal
        open={showCredentialsModal}
        onOpenChange={setShowCredentialsModal}
        onSuccess={handleCredentialsSuccess}
      />

      <ExportConfirmDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        startMonth={selectedPeriod?.startMonth || ''}
        endMonth={selectedPeriod?.endMonth || ''}
        onConfirm={handleConfirmExport}
        isExporting={isExporting}
      />
    </>
  );
}
