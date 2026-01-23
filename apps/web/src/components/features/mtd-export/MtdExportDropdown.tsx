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

interface MtdExportDropdownProps {
  selectedMonth: string; // YYYY-MM
  disabled?: boolean;
}

export function MtdExportDropdown({ selectedMonth, disabled }: MtdExportDropdownProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const { data: credentials } = useQuickFileCredentials();
  const exportCsv = useMtdExportCsv();
  const pushToQuickFile = useMtdExportQuickFile();

  const handleCsvDownload = async () => {
    setIsExporting(true);
    try {
      await exportCsv.mutateAsync({ month: selectedMonth });
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
    }
  };

  const handleQuickFilePush = async () => {
    if (!credentials?.configured) {
      setShowCredentialsModal(true);
      return;
    }
    setShowConfirmDialog(true);
  };

  const handleConfirmExport = async () => {
    setIsExporting(true);
    try {
      const result = await pushToQuickFile.mutateAsync({ month: selectedMonth });
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
          <DropdownMenuItem onClick={handleCsvDownload} disabled={isExporting}>
            <Download className="h-4 w-4 mr-2" />
            Download CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleQuickFilePush} disabled={isExporting}>
            <Upload className="h-4 w-4 mr-2" />
            Push to QuickFile
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <QuickFileCredentialsModal
        open={showCredentialsModal}
        onOpenChange={setShowCredentialsModal}
        onSuccess={handleCredentialsSuccess}
      />

      <ExportConfirmDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        month={selectedMonth}
        onConfirm={handleConfirmExport}
        isExporting={isExporting}
      />
    </>
  );
}
