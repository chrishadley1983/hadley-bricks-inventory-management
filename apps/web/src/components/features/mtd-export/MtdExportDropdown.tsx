'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import type { MtdBasis } from '@/types/mtd-export';

interface MtdExportDropdownProps {
  disabled?: boolean;
}

export function MtdExportDropdown({ disabled }: MtdExportDropdownProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showPeriodDialog, setShowPeriodDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<'csv' | 'quickfile' | null>(null);
  const [pendingBasis, setPendingBasis] = useState<MtdBasis>('accrual');
  const [selectedPeriod, setSelectedPeriod] = useState<{
    startMonth: string;
    endMonth: string;
  } | null>(null);

  const { data: credentials } = useQuickFileCredentials();
  const exportCsv = useMtdExportCsv();
  const pushToQuickFile = useMtdExportQuickFile();

  const handleCsvClick = (basis: MtdBasis) => {
    setPendingAction('csv');
    setPendingBasis(basis);
    setShowPeriodDialog(true);
  };

  const handleQuickFileClick = (basis: MtdBasis) => {
    setPendingAction('quickfile');
    setPendingBasis(basis);
    setShowPeriodDialog(true);
  };

  const handlePeriodConfirm = (startMonth: string, endMonth: string) => {
    setSelectedPeriod({ startMonth, endMonth });
    setShowPeriodDialog(false);

    if (pendingAction === 'csv') {
      handleCsvDownload(startMonth, endMonth, pendingBasis);
    } else if (pendingAction === 'quickfile') {
      if (!credentials?.configured) {
        setShowCredentialsModal(true);
      } else {
        setShowConfirmDialog(true);
      }
    }
  };

  const handleCsvDownload = async (startMonth: string, endMonth: string, basis: MtdBasis) => {
    setIsExporting(true);
    try {
      await exportCsv.mutateAsync({ startMonth, endMonth, basis });
      toast.success(`CSV downloaded successfully (${basis} basis)`);
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
        basis: pendingBasis,
      });
      toast.success(
        `Exported ${result.invoicesCreated} invoices and ${result.purchasesCreated} purchases to QuickFile (${pendingBasis} basis)`
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
          <DropdownMenuLabel>Accrual basis (sale dates)</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => handleCsvClick('accrual')} disabled={isExporting}>
            <Download className="h-4 w-4 mr-2" />
            Download CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleQuickFileClick('accrual')} disabled={isExporting}>
            <Upload className="h-4 w-4 mr-2" />
            Push to QuickFile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Cash basis (receipt dates)</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => handleCsvClick('cash')} disabled={isExporting}>
            <Download className="h-4 w-4 mr-2" />
            Download CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleQuickFileClick('cash')} disabled={isExporting}>
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
            ? `Choose the date range for your MTD CSV export (${pendingBasis} basis).`
            : `Choose the date range to export to QuickFile (${pendingBasis} basis).`
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
        basis={pendingBasis}
        onConfirm={handleConfirmExport}
        isExporting={isExporting}
      />
    </>
  );
}
