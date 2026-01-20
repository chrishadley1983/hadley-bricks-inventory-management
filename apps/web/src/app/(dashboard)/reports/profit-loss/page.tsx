'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, FileText, Loader2, TrendingUp, TrendingDown, ChevronDown, ChevronRight, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import { useProfitLossReport, useExportReport } from '@/hooks/use-reports';
import type { ProfitLossCategory } from '@/lib/services/profit-loss-report.service';
import { cn } from '@/lib/utils';
import { BarChart } from '@/components/charts/bar-chart';
import { ComboChart } from '@/components/charts/combo-chart';
import { useToast } from '@/hooks/use-toast';

// View preset types
type ViewPreset = 'last_12_months' | 'this_year' | 'last_year' | 'this_quarter' | 'last_quarter' | 'custom';

// Helper to get quarter info
function getQuarterMonths(year: number, quarter: number): string[] {
  const startMonth = (quarter - 1) * 3 + 1;
  return [
    `${year}-${String(startMonth).padStart(2, '0')}`,
    `${year}-${String(startMonth + 1).padStart(2, '0')}`,
    `${year}-${String(startMonth + 2).padStart(2, '0')}`,
  ];
}

function getCurrentQuarter(): number {
  return Math.floor(new Date().getMonth() / 3) + 1;
}

// Get months for a given preset
function getPresetMonths(preset: ViewPreset): string[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentQuarter = getCurrentQuarter();

  switch (preset) {
    case 'last_12_months': {
      const months: string[] = [];
      for (let i = 11; i >= 0; i--) {
        const date = new Date(currentYear, currentMonth - 1 - i, 1);
        months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
      }
      return months;
    }
    case 'this_year': {
      const months: string[] = [];
      for (let m = 1; m <= currentMonth; m++) {
        months.push(`${currentYear}-${String(m).padStart(2, '0')}`);
      }
      return months;
    }
    case 'last_year': {
      const months: string[] = [];
      for (let m = 1; m <= 12; m++) {
        months.push(`${currentYear - 1}-${String(m).padStart(2, '0')}`);
      }
      return months;
    }
    case 'this_quarter': {
      return getQuarterMonths(currentYear, currentQuarter);
    }
    case 'last_quarter': {
      if (currentQuarter === 1) {
        return getQuarterMonths(currentYear - 1, 4);
      }
      return getQuarterMonths(currentYear, currentQuarter - 1);
    }
    default:
      return [];
  }
}

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

// Category display order and styling
const categoryConfig: Record<ProfitLossCategory, { order: number; color: string }> = {
  'Income': { order: 1, color: 'bg-green-50' },
  'Selling Fees': { order: 2, color: 'bg-red-50' },
  'Stock Purchase': { order: 3, color: 'bg-orange-50' },
  'Packing & Postage': { order: 4, color: 'bg-blue-50' },
  'Bills': { order: 5, color: 'bg-purple-50' },
};

export default function ProfitLossReportPage() {
  const [viewPreset, setViewPreset] = useState<ViewPreset>('last_12_months');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const [expandedCategories, setExpandedCategories] = useState<Set<ProfitLossCategory>>(
    new Set(['Income', 'Selling Fees', 'Stock Purchase', 'Packing & Postage', 'Bills'])
  );

  // Fixed date range - always fetch last 24 months from today
  // This ensures data doesn't change when selecting different months
  const dateRange = useMemo(() => {
    const now = new Date();
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of current month
    const startDate = new Date(now.getFullYear() - 2, now.getMonth() + 1, 1); // 24 months back
    return { startDate, endDate };
  }, []); // No dependencies - fixed range

  // Handle preset change - also update selectedMonth to last month in preset
  const handlePresetChange = (value: string) => {
    if (!value) return;
    const preset = value as ViewPreset;
    setViewPreset(preset);

    // Update selectedMonth to the last month in the new preset view
    if (preset !== 'custom') {
      const presetMonths = getPresetMonths(preset);
      if (presetMonths.length > 0) {
        setSelectedMonth(presetMonths[presetMonths.length - 1]);
      }
    }
  };

  const { data: report, isLoading, error } = useProfitLossReport(dateRange, false);
  const exportMutation = useExportReport();
  const { toast } = useToast();
  const [exportingPdf, setExportingPdf] = useState(false);

  const handleExport = (format: 'csv' | 'json') => {
    exportMutation.mutate({
      reportType: 'profit-loss',
      format,
      dateRange,
    });
  };

  // PDF Export handler
  const handleExportPdf = async () => {
    if (!report || displayMonths.length === 0) {
      toast({ title: 'No data to export', variant: 'destructive' });
      return;
    }

    setExportingPdf(true);

    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');

      // Use landscape for more columns
      const doc = new jsPDF({ orientation: 'landscape' });
      let yPos = 12;

      // Compact styles
      const tableStyles = { fontSize: 6, cellPadding: 1 };
      const headStyles = { fontSize: 6, cellPadding: 1 };

      // Title and period
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Profit & Loss Report', 14, yPos);

      const periodLabel = viewPreset === 'last_12_months' ? 'Last 12 Months'
        : viewPreset === 'this_year' ? `${new Date().getFullYear()} YTD`
        : viewPreset === 'last_year' ? `${new Date().getFullYear() - 1} Full Year`
        : viewPreset === 'this_quarter' ? `Q${getCurrentQuarter()} ${new Date().getFullYear()}`
        : viewPreset === 'last_quarter' ? `Q${getCurrentQuarter() === 1 ? 4 : getCurrentQuarter() - 1} ${getCurrentQuarter() === 1 ? new Date().getFullYear() - 1 : new Date().getFullYear()}`
        : 'Custom';

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(` - ${periodLabel}`, 75, yPos);

      doc.setFontSize(7);
      doc.setTextColor(100);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 283, yPos, { align: 'right' });
      doc.setTextColor(0);
      yPos += 6;

      // Summary row (horizontal)
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      const summaryText = `Income: ${formatCurrency(summaryMetrics.income)}  |  Expenses: ${formatCurrency(summaryMetrics.expenses)}  |  Net Profit: ${formatCurrency(summaryMetrics.netProfit)}  |  Margin: ${summaryMetrics.profitMargin.toFixed(1)}%`;
      doc.text(summaryText, 14, yPos);
      yPos += 6;

      // Detailed breakdown table with all transaction types
      doc.setFontSize(8);
      doc.text('Detailed Breakdown', 14, yPos);
      yPos += 4;

      // Build detailed table with categories and their transaction types
      const categories = ['Income', 'Selling Fees', 'Stock Purchase', 'Packing & Postage', 'Bills'] as ProfitLossCategory[];
      const tableHead = ['Category / Transaction Type', ...displayMonths.map(formatMonth), 'Total', 'Monthly Avg'];
      const tableBody: (string | { content: string; styles?: Record<string, unknown> })[][] = [];

      // Track row indices for styling
      const categoryRowIndices: number[] = [];
      let rowIndex = 0;

      for (const category of categories) {
        const categoryTotals = report.categoryTotals?.[category] || {};
        const categoryTotal = displayMonths.reduce((sum, m) => sum + (categoryTotals[m] || 0), 0);

        // Skip empty categories
        if (categoryTotal === 0) continue;

        const categoryMonthlyAvg = displayMonths.length > 0 ? categoryTotal / displayMonths.length : 0;

        // Category header row
        categoryRowIndices.push(rowIndex);
        tableBody.push([
          { content: category, styles: { fontStyle: 'bold' } },
          ...displayMonths.map(m => formatCurrency(categoryTotals[m] || 0)),
          formatCurrency(categoryTotal),
          formatCurrency(categoryMonthlyAvg),
        ]);
        rowIndex++;

        // Transaction type rows within this category
        const categoryRows = report.rows.filter(r => r.category === category);
        for (const row of categoryRows) {
          const rowTotal = displayMonths.reduce((sum, m) => sum + (row.monthlyValues[m] || 0), 0);
          // Skip zero rows
          if (rowTotal === 0) continue;

          const rowMonthlyAvg = displayMonths.length > 0 ? rowTotal / displayMonths.length : 0;
          tableBody.push([
            `  ${row.transactionType}`,
            ...displayMonths.map(m => formatCurrency(row.monthlyValues[m] || 0)),
            formatCurrency(rowTotal),
            formatCurrency(rowMonthlyAvg),
          ]);
          rowIndex++;
        }
      }

      // Net Profit row
      const netProfitTotal = displayMonths.reduce((sum, m) => sum + (report.grandTotal?.[m] || 0), 0);
      const netProfitMonthlyAvg = displayMonths.length > 0 ? netProfitTotal / displayMonths.length : 0;
      const netProfitRowIndex = rowIndex;
      tableBody.push([
        { content: 'Net Profit / (Loss)', styles: { fontStyle: 'bold' } },
        ...displayMonths.map(m => formatCurrency(report.grandTotal?.[m] || 0)),
        formatCurrency(netProfitTotal),
        formatCurrency(netProfitMonthlyAvg),
      ]);

      autoTable(doc, {
        startY: yPos,
        head: [tableHead],
        body: tableBody,
        theme: 'grid',
        styles: tableStyles,
        headStyles: { ...headStyles, fillColor: [41, 128, 185] },
        margin: { left: 14, right: 14 },
        didParseCell: (data) => {
          if (data.section === 'body') {
            // Style category rows with light background
            if (categoryRowIndices.includes(data.row.index)) {
              data.cell.styles.fillColor = [245, 245, 245];
              data.cell.styles.fontStyle = 'bold';
            }
            // Style Net Profit row
            if (data.row.index === netProfitRowIndex) {
              data.cell.styles.fillColor = [220, 237, 200];
              data.cell.styles.fontStyle = 'bold';
            }
            // Color negative values red, positive green (skip first column)
            if (data.column.index > 0) {
              const cellText = String(data.cell.raw);
              if (cellText.startsWith('-') || cellText.startsWith('−')) {
                data.cell.styles.textColor = [220, 53, 69];
              } else if (cellText.startsWith('£') && !cellText.includes('0.00')) {
                data.cell.styles.textColor = [40, 167, 69];
              }
            }
          }
        },
        columnStyles: {
          0: { cellWidth: 45 }, // Category column wider
        },
      });

      // ========== PAGE 2: Summary & Charts ==========
      doc.addPage('landscape');
      yPos = 12;

      // Page 2 header
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Profit & Loss Report - Summary & Analysis', 14, yPos);
      doc.setFontSize(7);
      doc.setTextColor(100);
      doc.text(`${periodLabel} | Generated: ${new Date().toLocaleString()}`, 283, yPos, { align: 'right' });
      doc.setTextColor(0);
      yPos += 8;

      // Period Summary Table
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('Period Summary', 14, yPos);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text(`${formatMonth(displayMonths[0])} - ${formatMonth(displayMonths[displayMonths.length - 1])} (${displayMonths.length} month${displayMonths.length !== 1 ? 's' : ''})`, 55, yPos);
      yPos += 5;

      const summaryTableBody: string[][] = [];
      for (const category of categories) {
        const categoryTotals = report.categoryTotals?.[category] || {};
        const total = displayMonths.reduce((sum, m) => sum + (categoryTotals[m] || 0), 0);
        if (total === 0) continue;
        const monthlyAvg = displayMonths.length > 0 ? total / displayMonths.length : 0;
        summaryTableBody.push([category, formatCurrency(total), formatCurrency(monthlyAvg)]);
      }
      summaryTableBody.push(['Net Profit / (Loss)', formatCurrency(netProfitTotal), formatCurrency(netProfitMonthlyAvg)]);

      autoTable(doc, {
        startY: yPos,
        head: [['Category', 'Total', 'Monthly Avg']],
        body: summaryTableBody,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fontSize: 8, cellPadding: 2, fillColor: [41, 128, 185] },
        margin: { left: 14 },
        tableWidth: 120,
        didParseCell: (data) => {
          if (data.section === 'body') {
            // Style Net Profit row
            if (data.row.index === summaryTableBody.length - 1) {
              data.cell.styles.fillColor = [220, 237, 200];
              data.cell.styles.fontStyle = 'bold';
            }
            // Color values
            if (data.column.index > 0) {
              const cellText = String(data.cell.raw);
              if (cellText.startsWith('-') || cellText.startsWith('−')) {
                data.cell.styles.textColor = [220, 53, 69];
              } else if (cellText.startsWith('£') && !cellText.includes('0.00')) {
                data.cell.styles.textColor = [40, 167, 69];
              }
            }
          }
        },
      });

      yPos = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

      // Turnover by Platform Chart (bar chart representation)
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('Turnover by Platform', 14, yPos);
      yPos += 5;

      // Get platform data
      const ebayRow = report.rows.find(r => r.transactionType === 'eBay Gross Sales');
      const bricklinkRow = report.rows.find(r => r.transactionType === 'BrickLink Gross Sales');
      const amazonRow = report.rows.find(r => r.transactionType === 'Amazon Sales');
      const brickowlRow = report.rows.find(r => r.transactionType === 'Brick Owl Gross Sales');

      const platformTotals = [
        { name: 'eBay', total: displayMonths.reduce((sum, m) => sum + (ebayRow?.monthlyValues[m] || 0), 0), color: [59, 130, 246] },
        { name: 'BrickLink', total: displayMonths.reduce((sum, m) => sum + (bricklinkRow?.monthlyValues[m] || 0), 0), color: [239, 68, 68] },
        { name: 'Amazon', total: displayMonths.reduce((sum, m) => sum + (amazonRow?.monthlyValues[m] || 0), 0), color: [249, 115, 22] },
        { name: 'Brick Owl', total: displayMonths.reduce((sum, m) => sum + (brickowlRow?.monthlyValues[m] || 0), 0), color: [139, 92, 246] },
      ].filter(p => p.total > 0);

      const maxPlatformTotal = Math.max(...platformTotals.map(p => p.total));
      const barChartWidth = 200;
      const barHeight = 12;
      const barGap = 4;

      for (const platform of platformTotals) {
        const barWidth = maxPlatformTotal > 0 ? (platform.total / maxPlatformTotal) * barChartWidth : 0;

        // Draw bar
        doc.setFillColor(platform.color[0], platform.color[1], platform.color[2]);
        doc.rect(70, yPos - 8, barWidth, barHeight, 'F');

        // Platform name
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0);
        doc.text(platform.name, 14, yPos);

        // Value at end of bar
        doc.text(formatCurrency(platform.total), 75 + barWidth, yPos);

        yPos += barHeight + barGap;
      }

      yPos += 8;

      // Profit by Month Chart (simplified table view)
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('Monthly Profit Trend', 14, yPos);
      yPos += 5;

      const profitTrendBody: string[][] = displayMonths.map(month => {
        const turnover = report.categoryTotals?.['Income']?.[month] || 0;
        const sellingFees = Math.abs(report.categoryTotals?.['Selling Fees']?.[month] || 0);
        const packingPostage = Math.abs(report.categoryTotals?.['Packing & Postage']?.[month] || 0);
        const bills = Math.abs(report.categoryTotals?.['Bills']?.[month] || 0);
        const cog = Math.abs(report.categoryTotals?.['Stock Purchase']?.[month] || 0);
        const profit = report.grandTotal?.[month] || 0;

        return [
          formatMonth(month),
          formatCurrency(turnover),
          formatCurrency(sellingFees + packingPostage + bills),
          formatCurrency(cog),
          formatCurrency(profit),
        ];
      });

      autoTable(doc, {
        startY: yPos,
        head: [['Month', 'Turnover', 'Selling & Ops', 'COG', 'Profit']],
        body: profitTrendBody,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fontSize: 7, cellPadding: 1.5, fillColor: [46, 204, 113] },
        margin: { left: 14, right: 14 },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 4) {
            // Color profit column
            const cellText = String(data.cell.raw);
            if (cellText.startsWith('-') || cellText.startsWith('−')) {
              data.cell.styles.textColor = [220, 53, 69];
            } else if (!cellText.includes('0.00')) {
              data.cell.styles.textColor = [40, 167, 69];
            }
          }
        },
      });

      doc.save(`profit-loss-${periodLabel.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.pdf`);
      toast({ title: 'PDF exported successfully' });
    } catch (error) {
      console.error('PDF export error:', error);
      toast({ title: 'Failed to export PDF', variant: 'destructive' });
    } finally {
      setExportingPdf(false);
    }
  };

  const toggleCategory = (category: ProfitLossCategory) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Group rows by category
  const groupedRows = useMemo(() => {
    type ReportRow = NonNullable<typeof report>['rows'][number];
    const groups = new Map<ProfitLossCategory, ReportRow[]>();
    if (!report?.rows) return groups;

    for (const row of report.rows) {
      if (!groups.has(row.category)) {
        groups.set(row.category, []);
      }
      groups.get(row.category)!.push(row);
    }
    return groups;
  }, [report?.rows]);

  // Get display months based on preset or custom selection
  const displayMonths = useMemo(() => {
    if (!report?.months) return [];

    // For preset views, use the preset months (filtered to available data)
    if (viewPreset !== 'custom') {
      const presetMonths = getPresetMonths(viewPreset);
      // Filter to only include months that exist in our data
      return presetMonths.filter(m => report.months.includes(m));
    }

    // Custom view: 6 months ending with selected month
    const selectedIndex = report.months.indexOf(selectedMonth);

    if (selectedIndex === -1) {
      // Selected month not in data, show last 6 months
      return report.months.slice(-6);
    }

    // Show 6 months ending with selected month (or fewer if not enough history)
    const startIndex = Math.max(0, selectedIndex - 5);
    return report.months.slice(startIndex, selectedIndex + 1);
  }, [report?.months, selectedMonth, viewPreset]);

  // Calculate summary metrics for the displayed period
  const summaryMetrics = useMemo(() => {
    if (!report?.categoryTotals || !report?.grandTotal || displayMonths.length === 0) {
      return { income: 0, expenses: 0, netProfit: 0, profitMargin: 0 };
    }

    // Sum up values across all displayed months
    let income = 0;
    let sellingFees = 0;
    let stockPurchase = 0;
    let packingPostage = 0;
    let bills = 0;
    let netProfit = 0;

    for (const month of displayMonths) {
      income += report.categoryTotals['Income']?.[month] || 0;
      sellingFees += Math.abs(report.categoryTotals['Selling Fees']?.[month] || 0);
      stockPurchase += Math.abs(report.categoryTotals['Stock Purchase']?.[month] || 0);
      packingPostage += Math.abs(report.categoryTotals['Packing & Postage']?.[month] || 0);
      bills += Math.abs(report.categoryTotals['Bills']?.[month] || 0);
      netProfit += report.grandTotal[month] || 0;
    }

    const expenses = sellingFees + stockPurchase + packingPostage + bills;
    const profitMargin = income > 0 ? (netProfit / income) * 100 : 0;

    return { income, expenses, netProfit, profitMargin };
  }, [report, displayMonths]);

  // Generate month options for selector
  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      options.push({ value, label });
    }
    return options;
  }, []);

  // Chart data: Turnover by Platform by Month (stacked bar chart)
  const turnoverByPlatformData = useMemo(() => {
    if (!report?.rows || displayMonths.length === 0) return [];

    // Find the income rows for each platform
    const ebayRow = report.rows.find(r => r.transactionType === 'eBay Gross Sales');
    const bricklinkRow = report.rows.find(r => r.transactionType === 'BrickLink Gross Sales');
    const brickowlRow = report.rows.find(r => r.transactionType === 'Brick Owl Gross Sales');
    const amazonRow = report.rows.find(r => r.transactionType === 'Amazon Sales');

    return displayMonths.map(month => ({
      month,
      eBay: ebayRow?.monthlyValues[month] || 0,
      BrickLink: bricklinkRow?.monthlyValues[month] || 0,
      BrickOwl: brickowlRow?.monthlyValues[month] || 0,
      Amazon: amazonRow?.monthlyValues[month] || 0,
    }));
  }, [report?.rows, displayMonths]);

  // Chart data: Profit by Month (combo chart - bars for profit, lines for other metrics)
  const profitByMonthData = useMemo(() => {
    if (!report?.categoryTotals || !report?.grandTotal || displayMonths.length === 0) return [];

    return displayMonths.map(month => {
      const turnover = report.categoryTotals['Income']?.[month] || 0;
      const sellingFees = Math.abs(report.categoryTotals['Selling Fees']?.[month] || 0);
      const packingPostage = Math.abs(report.categoryTotals['Packing & Postage']?.[month] || 0);
      const bills = Math.abs(report.categoryTotals['Bills']?.[month] || 0);
      const cog = Math.abs(report.categoryTotals['Stock Purchase']?.[month] || 0);
      const profit = report.grandTotal[month] || 0;

      return {
        month,
        Turnover: turnover,
        'Selling & Ops': sellingFees + packingPostage + bills,
        COG: cog,
        Profit: profit,
      };
    });
  }, [report?.categoryTotals, report?.grandTotal, displayMonths]);

  return (
    <>
      <Header title="Profit & Loss Report" />
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/reports">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Profit & Loss</h1>
                <p className="text-muted-foreground">
                  Detailed breakdown by category and transaction type
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleExportPdf}
                disabled={exportingPdf || isLoading}
              >
                {exportingPdf ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                Export PDF
              </Button>
              <Button
                variant="outline"
                onClick={() => handleExport('csv')}
                disabled={exportMutation.isPending}
              >
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </div>

          {/* View Presets */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">View:</span>
            </div>
            <ToggleGroup
              type="single"
              value={viewPreset}
              onValueChange={handlePresetChange}
              className="flex-wrap"
            >
              <ToggleGroupItem value="last_12_months" aria-label="Last 12 months" className="text-xs sm:text-sm">
                Last 12 Months
              </ToggleGroupItem>
              <ToggleGroupItem value="this_year" aria-label="This year" className="text-xs sm:text-sm">
                This Year
              </ToggleGroupItem>
              <ToggleGroupItem value="last_year" aria-label="Last year" className="text-xs sm:text-sm">
                Last Year
              </ToggleGroupItem>
              <ToggleGroupItem value="this_quarter" aria-label="This quarter" className="text-xs sm:text-sm">
                This Quarter
              </ToggleGroupItem>
              <ToggleGroupItem value="last_quarter" aria-label="Last quarter" className="text-xs sm:text-sm">
                Last Quarter
              </ToggleGroupItem>
              <ToggleGroupItem value="custom" aria-label="Custom" className="text-xs sm:text-sm">
                Custom
              </ToggleGroupItem>
            </ToggleGroup>

            {/* Month selector - only show in custom mode */}
            {viewPreset === 'custom' && (
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Failed to load report. Please try again.
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Key Metrics */}
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Income
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    {formatCurrency(summaryMetrics.income)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Expenses
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">
                    {formatCurrency(summaryMetrics.expenses)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Net Profit
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={cn(
                    "text-2xl font-bold flex items-center gap-2",
                    summaryMetrics.netProfit >= 0 ? "text-green-600" : "text-red-600"
                  )}>
                    {formatCurrency(summaryMetrics.netProfit)}
                    {summaryMetrics.netProfit >= 0 ? (
                      <TrendingUp className="h-5 w-5" />
                    ) : (
                      <TrendingDown className="h-5 w-5" />
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Profit Margin
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={cn(
                    "text-2xl font-bold",
                    summaryMetrics.profitMargin >= 0 ? "text-green-600" : "text-red-600"
                  )}>
                    {summaryMetrics.profitMargin.toFixed(1)}%
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Detailed Breakdown Table */}
            <Card>
              <CardHeader>
                <CardTitle>Detailed Breakdown</CardTitle>
                <CardDescription>
                  Click category headers to expand/collapse.{' '}
                  {viewPreset === 'last_12_months' && 'Showing last 12 months.'}
                  {viewPreset === 'this_year' && `Showing ${new Date().getFullYear()} year to date.`}
                  {viewPreset === 'last_year' && `Showing ${new Date().getFullYear() - 1} full year.`}
                  {viewPreset === 'this_quarter' && `Showing Q${getCurrentQuarter()} ${new Date().getFullYear()}.`}
                  {viewPreset === 'last_quarter' && (() => {
                    const q = getCurrentQuarter();
                    return q === 1
                      ? `Showing Q4 ${new Date().getFullYear() - 1}.`
                      : `Showing Q${q - 1} ${new Date().getFullYear()}.`;
                  })()}
                  {viewPreset === 'custom' && 'Showing 6 months ending with selected month.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[250px]">Category / Transaction Type</TableHead>
                        {displayMonths.map((month) => (
                          <TableHead
                            key={month}
                            className={cn(
                              "text-right min-w-[100px]",
                              month === selectedMonth && "bg-blue-50 font-bold"
                            )}
                          >
                            {formatMonth(month)}
                          </TableHead>
                        ))}
                        <TableHead className="text-right min-w-[120px] font-bold">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* Render categories in order */}
                      {Object.entries(categoryConfig)
                        .sort((a, b) => a[1].order - b[1].order)
                        .map(([category, config]) => {
                          const categoryRows = groupedRows.get(category as ProfitLossCategory) || [];
                          const isExpanded = expandedCategories.has(category as ProfitLossCategory);
                          const categoryTotals = report?.categoryTotals?.[category as ProfitLossCategory] || {};

                          // Calculate category total across all displayed months
                          const categoryTotal = displayMonths.reduce(
                            (sum, month) => sum + (categoryTotals[month] || 0),
                            0
                          );

                          // Skip empty categories
                          if (categoryRows.length === 0 && categoryTotal === 0) return null;

                          return (
                            <React.Fragment key={category}>
                              {/* Category Header Row */}
                              <TableRow
                                className={cn(
                                  "cursor-pointer hover:bg-muted/50",
                                  config.color
                                )}
                                onClick={() => toggleCategory(category as ProfitLossCategory)}
                              >
                                <TableCell className="font-bold">
                                  <div className="flex items-center gap-2">
                                    {isExpanded ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                    {category}
                                  </div>
                                </TableCell>
                                {displayMonths.map((month) => (
                                  <TableCell
                                    key={month}
                                    className={cn(
                                      "text-right font-bold",
                                      month === selectedMonth && "bg-blue-100",
                                      (categoryTotals[month] || 0) < 0 && "text-red-600",
                                      (categoryTotals[month] || 0) > 0 && "text-green-600"
                                    )}
                                  >
                                    {formatCurrency(categoryTotals[month] || 0)}
                                  </TableCell>
                                ))}
                                <TableCell
                                  className={cn(
                                    "text-right font-bold",
                                    categoryTotal < 0 && "text-red-600",
                                    categoryTotal > 0 && "text-green-600"
                                  )}
                                >
                                  {formatCurrency(categoryTotal)}
                                </TableCell>
                              </TableRow>

                              {/* Transaction Type Rows (when expanded) */}
                              {isExpanded &&
                                categoryRows.map((row) => {
                                  const rowTotal = displayMonths.reduce(
                                    (sum, month) => sum + (row.monthlyValues[month] || 0),
                                    0
                                  );

                                  return (
                                    <TableRow key={row.transactionType} className="text-sm">
                                      <TableCell className="pl-10 text-muted-foreground">
                                        {row.transactionType}
                                      </TableCell>
                                      {displayMonths.map((month) => (
                                        <TableCell
                                          key={month}
                                          className={cn(
                                            "text-right",
                                            month === selectedMonth && "bg-blue-50",
                                            (row.monthlyValues[month] || 0) < 0 && "text-red-600",
                                            (row.monthlyValues[month] || 0) > 0 && "text-green-600"
                                          )}
                                        >
                                          {formatCurrency(row.monthlyValues[month] || 0)}
                                        </TableCell>
                                      ))}
                                      <TableCell
                                        className={cn(
                                          "text-right",
                                          rowTotal < 0 && "text-red-600",
                                          rowTotal > 0 && "text-green-600"
                                        )}
                                      >
                                        {formatCurrency(rowTotal)}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                            </React.Fragment>
                          );
                        })}

                      {/* Grand Total Row */}
                      <TableRow className="border-t-2 bg-muted/50 font-bold">
                        <TableCell>Net Profit / (Loss)</TableCell>
                        {displayMonths.map((month) => {
                          const value = report?.grandTotal?.[month] || 0;
                          return (
                            <TableCell
                              key={month}
                              className={cn(
                                "text-right",
                                month === selectedMonth && "bg-blue-100",
                                value < 0 && "text-red-600",
                                value >= 0 && "text-green-600"
                              )}
                            >
                              {formatCurrency(value)}
                            </TableCell>
                          );
                        })}
                        <TableCell
                          className={cn(
                            "text-right",
                            (displayMonths.reduce((sum, m) => sum + (report?.grandTotal?.[m] || 0), 0)) < 0
                              ? "text-red-600"
                              : "text-green-600"
                          )}
                        >
                          {formatCurrency(
                            displayMonths.reduce((sum, m) => sum + (report?.grandTotal?.[m] || 0), 0)
                          )}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Period Summary Card */}
            <Card>
              <CardHeader>
                <CardTitle>
                  Period Summary
                </CardTitle>
                <CardDescription>
                  {displayMonths.length > 0 && (
                    <>
                      {formatMonth(displayMonths[0])} - {formatMonth(displayMonths[displayMonths.length - 1])}
                      {' '}({displayMonths.length} month{displayMonths.length !== 1 ? 's' : ''})
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Monthly Avg</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(categoryConfig)
                      .sort((a, b) => a[1].order - b[1].order)
                      .map(([category]) => {
                        // Sum up values for all displayed months
                        const value = displayMonths.reduce(
                          (sum, month) => sum + (report?.categoryTotals?.[category as ProfitLossCategory]?.[month] || 0),
                          0
                        );
                        if (value === 0) return null;

                        const monthlyAvg = displayMonths.length > 0 ? value / displayMonths.length : 0;

                        return (
                          <TableRow key={category}>
                            <TableCell className="font-medium">{category}</TableCell>
                            <TableCell
                              className={cn(
                                "text-right",
                                value < 0 && "text-red-600",
                                value > 0 && "text-green-600"
                              )}
                            >
                              {formatCurrency(value)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right",
                                monthlyAvg < 0 && "text-red-600",
                                monthlyAvg > 0 && "text-green-600"
                              )}
                            >
                              {formatCurrency(monthlyAvg)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    <TableRow className="border-t-2 font-bold">
                      <TableCell>Net Profit / (Loss)</TableCell>
                      <TableCell
                        className={cn(
                          "text-right",
                          summaryMetrics.netProfit < 0 && "text-red-600",
                          summaryMetrics.netProfit >= 0 && "text-green-600"
                        )}
                      >
                        {formatCurrency(summaryMetrics.netProfit)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right",
                          summaryMetrics.netProfit < 0 && "text-red-600",
                          summaryMetrics.netProfit >= 0 && "text-green-600"
                        )}
                      >
                        {formatCurrency(displayMonths.length > 0 ? summaryMetrics.netProfit / displayMonths.length : 0)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Charts Section */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Turnover by Platform Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Turnover by Platform</CardTitle>
                  <CardDescription>
                    Monthly sales breakdown by selling platform
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <BarChart
                    data={turnoverByPlatformData}
                    xAxisKey="month"
                    bars={[
                      { dataKey: 'eBay', name: 'eBay', color: '#3b82f6', stackId: 'turnover' },
                      { dataKey: 'BrickLink', name: 'BrickLink', color: '#ef4444', stackId: 'turnover' },
                      { dataKey: 'BrickOwl', name: 'Brick Owl', color: '#8b5cf6', stackId: 'turnover' },
                      { dataKey: 'Amazon', name: 'Amazon', color: '#f97316', stackId: 'turnover' },
                    ]}
                    height={350}
                    formatXAxis={formatMonth}
                    formatYAxis={(v) => `£${(v / 1000).toFixed(0)}k`}
                    formatTooltip={(v) => formatCurrency(v)}
                  />
                </CardContent>
              </Card>

              {/* Profit by Month Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Profit by Month</CardTitle>
                  <CardDescription>
                    Monthly profit with turnover, costs and expenses
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ComboChart
                    data={profitByMonthData}
                    xAxisKey="month"
                    bars={[
                      { dataKey: 'Profit', name: 'Profit', color: '#3b82f6' },
                    ]}
                    lines={[
                      { dataKey: 'Turnover', name: 'Turnover', color: '#eab308', strokeWidth: 2 },
                      { dataKey: 'Selling & Ops', name: 'Selling & Ops', color: '#22c55e', strokeWidth: 2 },
                      { dataKey: 'COG', name: 'COG', color: '#ef4444', strokeWidth: 2 },
                    ]}
                    height={350}
                    showZeroLine={true}
                    formatXAxis={formatMonth}
                    formatYAxis={(v) => `£${(v / 1000).toFixed(0)}k`}
                    formatTooltip={(v) => formatCurrency(v)}
                  />
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}
