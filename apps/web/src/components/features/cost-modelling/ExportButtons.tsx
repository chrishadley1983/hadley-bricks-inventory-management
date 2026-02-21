/**
 * Export Buttons Component
 * F51-F54: PDF and CSV export functionality
 */

'use client';

import { useState, useCallback } from 'react';
import { Download, FileText, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import type { CostModelScenarioFormData, CalculatedResults } from '@/types/cost-modelling';
import { formatCurrency, formatPercentage } from '@/lib/services/cost-calculations';

interface ExportButtonsProps {
  formData: CostModelScenarioFormData | null;
  calculations: CalculatedResults | null;
}

export function ExportButtons({ formData, calculations }: ExportButtonsProps) {
  const { toast } = useToast();
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  // F52, F54: Export to CSV
  const handleExportCsv = useCallback(async () => {
    if (!formData || !calculations) {
      toast({ title: 'No data to export', variant: 'destructive' });
      return;
    }

    setExportingCsv(true);
    const startTime = performance.now();

    try {
      // Build CSV content with all assumptions and calculated values
      const rows: string[][] = [
        ['Cost Modelling Export'],
        ['Scenario Name', formData.name],
        ['Generated', new Date().toLocaleString()],
        [],
        ['=== ASSUMPTIONS ==='],
        [],
        ['Sales Volume (per month)'],
        ['Platform', 'Sales/Month', 'Avg Sale Value', 'Avg Postage Cost'],
        [
          'BrickLink',
          String(formData.blSalesPerMonth),
          formData.blAvgSaleValue.toFixed(2),
          formData.blAvgPostageCost.toFixed(2),
        ],
        [
          'Amazon',
          String(formData.amazonSalesPerMonth),
          formData.amazonAvgSaleValue.toFixed(2),
          formData.amazonAvgPostageCost.toFixed(2),
        ],
        [
          'eBay',
          String(formData.ebaySalesPerMonth),
          formData.ebayAvgSaleValue.toFixed(2),
          formData.ebayAvgPostageCost.toFixed(2),
        ],
        [],
        ['Fee Rates'],
        ['BrickLink', formatPercentage(formData.blFeeRate)],
        ['Amazon', formatPercentage(formData.amazonFeeRate)],
        ['eBay', formatPercentage(formData.ebayFeeRate)],
        [],
        ['COG Percentages'],
        ['BrickLink', formatPercentage(formData.blCogPercent)],
        ['Amazon', formatPercentage(formData.amazonCogPercent)],
        ['eBay', formatPercentage(formData.ebayCogPercent)],
        [],
        ['Fixed Costs (Monthly)'],
        ['Shopify', formData.fixedShopify.toFixed(2)],
        ['eBay Store', formData.fixedEbayStore.toFixed(2)],
        ['Seller Tools', formData.fixedSellerTools.toFixed(2)],
        ['Amazon', formData.fixedAmazon.toFixed(2)],
        ['Storage', formData.fixedStorage.toFixed(2)],
        [],
        ['Annual Costs'],
        ['Accountant', formData.annualAccountantCost.toFixed(2)],
        ['Misc', formData.annualMiscCosts.toFixed(2)],
        [],
        ['VAT Settings'],
        ['VAT Registered', formData.isVatRegistered ? 'Yes' : 'No'],
        ['VAT Flat Rate', formatPercentage(formData.vatFlatRate)],
        [],
        ['Tax Settings'],
        ['Target Annual Profit', formData.targetAnnualProfit.toFixed(2)],
        ['Personal Allowance', formData.personalAllowance.toFixed(2)],
        ['Income Tax Rate', formatPercentage(formData.incomeTaxRate)],
        ['NI Rate', formatPercentage(formData.niRate)],
        [],
        ['=== CALCULATED RESULTS ==='],
        [],
        ['Turnover'],
        ['BrickLink', calculations.blTurnover.toFixed(2)],
        ['Amazon', calculations.amazonTurnover.toFixed(2)],
        ['eBay', calculations.ebayTurnover.toFixed(2)],
        ['Total', calculations.totalTurnover.toFixed(2)],
        [],
        ['Fees'],
        ['BrickLink', calculations.blFees.toFixed(2)],
        ['Amazon', calculations.amazonFees.toFixed(2)],
        ['eBay', calculations.ebayFees.toFixed(2)],
        ['Total', calculations.totalFees.toFixed(2)],
        [],
        ['VAT', calculations.vatAmount.toFixed(2)],
        [],
        ['COG'],
        ['BrickLink', calculations.blCog.toFixed(2)],
        ['Amazon', calculations.amazonCog.toFixed(2)],
        ['eBay', calculations.ebayCog.toFixed(2)],
        ['Total', calculations.totalCog.toFixed(2)],
        [],
        ['Other Costs'],
        ['Annual Fixed Costs', calculations.annualFixedCosts.toFixed(2)],
        ['Total Postage', calculations.totalPostage.toFixed(2)],
        ['Lego Parts', calculations.legoParts.toFixed(2)],
        ['Accountant', calculations.accountantCost.toFixed(2)],
        ['Total Other Costs', calculations.totalOtherCosts.toFixed(2)],
        [],
        ['Profit'],
        ['Gross Profit', calculations.grossProfit.toFixed(2)],
        ['Net Profit', calculations.netProfit.toFixed(2)],
        ['vs Target', calculations.profitVsTarget.toFixed(2)],
        [],
        ['Tax'],
        ['Taxable Income', calculations.taxableIncome.toFixed(2)],
        ['Income Tax', calculations.incomeTax.toFixed(2)],
        ['National Insurance', calculations.nationalInsurance.toFixed(2)],
        ['Total Tax', calculations.totalTax.toFixed(2)],
        [],
        ['Take-Home'],
        ['Annual', calculations.takeHome.toFixed(2)],
        ['Weekly', calculations.weeklyTakeHome.toFixed(2)],
        [],
        ['Daily/Weekly Metrics'],
        ['Sales Per Day', calculations.salesPerDay.toFixed(2)],
        ['Sales Per Week', calculations.salesPerWeek.toFixed(2)],
        ['Turnover Per Day', calculations.turnoverPerDay.toFixed(2)],
        ['Turnover Per Week', calculations.turnoverPerWeek.toFixed(2)],
        ['COG Budget Per Day', calculations.cogBudgetPerDay.toFixed(2)],
        ['COG Budget Per Week', calculations.cogBudgetPerWeek.toFixed(2)],
      ];

      const csvContent = rows.map((row) => row.join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cost-model-${formData.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const duration = performance.now() - startTime;
      // P6: CSV should generate in <1000ms
      if (duration > 1000) {
        console.warn(`CSV export took ${duration}ms (>1000ms threshold)`);
      }

      toast({ title: 'CSV exported successfully' });
    } catch (error) {
      console.error('CSV export error:', error);
      toast({ title: 'Failed to export CSV', variant: 'destructive' });
    } finally {
      setExportingCsv(false);
    }
  }, [formData, calculations, toast]);

  // F51, F53: Export to PDF
  const handleExportPdf = useCallback(async () => {
    if (!formData || !calculations) {
      toast({ title: 'No data to export', variant: 'destructive' });
      return;
    }

    setExportingPdf(true);
    const startTime = performance.now();

    try {
      // Dynamic import jsPDF to reduce initial bundle
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');

      const doc = new jsPDF();
      let yPos = 15;

      // Compact table styles for single-page fit
      const tableStyles = {
        fontSize: 8,
        cellPadding: 2,
      };
      const headStyles = {
        fontSize: 8,
        cellPadding: 2,
      };

      // Title
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Cost Modelling Report', 14, yPos);
      yPos += 7;

      // Scenario name and date on same line
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(formData.name, 14, yPos);
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 196, yPos, { align: 'right' });
      doc.setTextColor(0);
      yPos += 8;

      // Hero Metrics
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Summary', 14, yPos);
      yPos += 5;

      autoTable(doc, {
        startY: yPos,
        head: [['Metric', 'Value']],
        body: [
          ['Annual Profit', formatCurrency(calculations.netProfit)],
          ['Take-Home (Annual)', formatCurrency(calculations.takeHome)],
          ['Take-Home (Weekly)', formatCurrency(calculations.weeklyTakeHome)],
          ['vs Target', formatCurrency(calculations.profitVsTarget)],
        ],
        theme: 'grid',
        styles: tableStyles,
        headStyles: { ...headStyles, fillColor: [41, 128, 185] },
        margin: { left: 14, right: 14 },
      });

      yPos = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

      // Revenue by platform
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Revenue by Platform', 14, yPos);
      yPos += 5;

      autoTable(doc, {
        startY: yPos,
        head: [['Platform', 'Turnover', 'Fees', 'COG', 'Net']],
        body: [
          [
            'BrickLink',
            formatCurrency(calculations.blTurnover),
            formatCurrency(calculations.blFees),
            formatCurrency(calculations.blCog),
            formatCurrency(calculations.blTurnover - calculations.blFees - calculations.blCog),
          ],
          [
            'Amazon',
            formatCurrency(calculations.amazonTurnover),
            formatCurrency(calculations.amazonFees),
            formatCurrency(calculations.amazonCog),
            formatCurrency(
              calculations.amazonTurnover - calculations.amazonFees - calculations.amazonCog
            ),
          ],
          [
            'eBay',
            formatCurrency(calculations.ebayTurnover),
            formatCurrency(calculations.ebayFees),
            formatCurrency(calculations.ebayCog),
            formatCurrency(
              calculations.ebayTurnover - calculations.ebayFees - calculations.ebayCog
            ),
          ],
          [
            'Total',
            formatCurrency(calculations.totalTurnover),
            formatCurrency(calculations.totalFees),
            formatCurrency(calculations.totalCog),
            formatCurrency(
              calculations.totalTurnover - calculations.totalFees - calculations.totalCog
            ),
          ],
        ],
        theme: 'grid',
        styles: tableStyles,
        headStyles: { ...headStyles, fillColor: [46, 204, 113] },
        margin: { left: 14, right: 14 },
      });

      yPos = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

      // Two-column layout for Costs and Tax
      const pageWidth = doc.internal.pageSize.getWidth();
      const colWidth = (pageWidth - 28 - 10) / 2; // 14 margin each side, 10 gap

      // Other Costs (left column)
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Costs Breakdown', 14, yPos);

      // Tax breakdown (right column)
      doc.text('Tax Summary', 14 + colWidth + 10, yPos);
      yPos += 5;

      const costsStartY = yPos;

      autoTable(doc, {
        startY: yPos,
        head: [['Cost Category', 'Amount']],
        body: [
          ['Fixed Costs', formatCurrency(calculations.annualFixedCosts)],
          ['Postage', formatCurrency(calculations.totalPostage)],
          ['Packaging', formatCurrency(calculations.packagingMaterials)],
          ['Lego Parts', formatCurrency(calculations.legoParts)],
          ['Accountant', formatCurrency(calculations.accountantCost)],
          ['COG', formatCurrency(calculations.totalCog)],
          ['Platform Fees', formatCurrency(calculations.totalFees)],
          ...(calculations.vatAmount > 0 ? [['VAT', formatCurrency(calculations.vatAmount)]] : []),
        ],
        theme: 'grid',
        styles: tableStyles,
        headStyles: { ...headStyles, fillColor: [231, 76, 60] },
        margin: { left: 14 },
        tableWidth: colWidth,
      });

      autoTable(doc, {
        startY: costsStartY,
        head: [['Tax Type', 'Amount']],
        body: [
          ['Taxable Income', formatCurrency(calculations.taxableIncome)],
          ['Income Tax', formatCurrency(calculations.incomeTax)],
          ['National Insurance', formatCurrency(calculations.nationalInsurance)],
          ['Total Tax', formatCurrency(calculations.totalTax)],
        ],
        theme: 'grid',
        styles: tableStyles,
        headStyles: { ...headStyles, fillColor: [155, 89, 182] },
        margin: { left: 14 + colWidth + 10 },
        tableWidth: colWidth,
      });

      // Save PDF
      doc.save(`cost-model-${formData.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.pdf`);

      const duration = performance.now() - startTime;
      // P5: PDF should generate in <5000ms
      if (duration > 5000) {
        console.warn(`PDF export took ${duration}ms (>5000ms threshold)`);
      }

      toast({ title: 'PDF exported successfully' });
    } catch (error) {
      console.error('PDF export error:', error);
      toast({ title: 'Failed to export PDF', variant: 'destructive' });
    } finally {
      setExportingPdf(false);
    }
  }, [formData, calculations, toast]);

  const isDisabled = !formData || !calculations;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={isDisabled}>
          {exportingPdf || exportingCsv ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={handleExportPdf} disabled={exportingPdf}>
          <FileText className="mr-2 h-4 w-4" />
          Export as PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportCsv} disabled={exportingCsv}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Export as CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
