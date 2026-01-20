'use client';

/**
 * P&L Breakdown Component
 * F23: Shows detailed breakdown of revenue, costs, and profit
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatCurrency } from '@/lib/services/cost-calculations';
import type { CalculatedResults } from '@/types/cost-modelling';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState, useMemo } from 'react';

type PeriodType = 'yearly' | 'monthly';

interface PLBreakdownProps {
  calculations: CalculatedResults;
  isVatRegistered: boolean;
  /** Compact mode for compare view - collapsed by default */
  compact?: boolean;
}

export function PLBreakdown({ calculations, isVatRegistered, compact }: PLBreakdownProps) {
  const defaultExpanded = compact ? false : true;
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    revenue: defaultExpanded,
    fees: defaultExpanded,
    otherCosts: defaultExpanded,
    cog: defaultExpanded,
    tax: defaultExpanded,
  });
  const [period, setPeriod] = useState<PeriodType>('yearly');

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Scale values based on period
  const divisor = period === 'monthly' ? 12 : 1;
  const scaled = useMemo(() => {
    const scale = (value: number) => value / divisor;
    return {
      totalTurnover: scale(calculations.totalTurnover),
      blTurnover: scale(calculations.blTurnover),
      amazonTurnover: scale(calculations.amazonTurnover),
      ebayTurnover: scale(calculations.ebayTurnover),
      totalFees: scale(calculations.totalFees),
      blFees: scale(calculations.blFees),
      amazonFees: scale(calculations.amazonFees),
      ebayFees: scale(calculations.ebayFees),
      vatAmount: scale(calculations.vatAmount),
      totalOtherCosts: scale(calculations.totalOtherCosts),
      annualFixedCosts: scale(calculations.annualFixedCosts),
      totalPostage: scale(calculations.totalPostage),
      packagingMaterials: scale(calculations.packagingMaterials),
      legoParts: scale(calculations.legoParts),
      accountantCost: scale(calculations.accountantCost),
      grossProfit: scale(calculations.grossProfit),
      totalCog: scale(calculations.totalCog),
      blCog: scale(calculations.blCog),
      amazonCog: scale(calculations.amazonCog),
      ebayCog: scale(calculations.ebayCog),
      netProfit: scale(calculations.netProfit),
      totalTax: scale(calculations.totalTax),
      taxableIncome: scale(calculations.taxableIncome),
      incomeTax: scale(calculations.incomeTax),
      nationalInsurance: scale(calculations.nationalInsurance),
      takeHome: scale(calculations.takeHome),
      weeklyTakeHome: calculations.weeklyTakeHome, // Already weekly
    };
  }, [calculations, divisor]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>P&L Breakdown</CardTitle>
        <ToggleGroup
          type="single"
          value={period}
          onValueChange={(value: string) => value && setPeriod(value as PeriodType)}
          size="sm"
        >
          <ToggleGroupItem value="yearly" aria-label="Yearly view">
            Yearly
          </ToggleGroupItem>
          <ToggleGroupItem value="monthly" aria-label="Monthly view">
            Monthly
          </ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Revenue Section */}
        <SectionHeader
          title="Revenue (Turnover)"
          total={scaled.totalTurnover}
          expanded={expandedSections.revenue}
          onToggle={() => toggleSection('revenue')}
        />
        {expandedSections.revenue && (
          <div className="ml-6 space-y-1">
            <LineItem label="BrickLink" value={scaled.blTurnover} />
            <LineItem label="Amazon" value={scaled.amazonTurnover} />
            <LineItem label="eBay" value={scaled.ebayTurnover} />
          </div>
        )}

        {/* Platform Fees Section */}
        <SectionHeader
          title="Platform Fees"
          total={-scaled.totalFees}
          expanded={expandedSections.fees}
          onToggle={() => toggleSection('fees')}
          negative
        />
        {expandedSections.fees && (
          <div className="ml-6 space-y-1">
            <LineItem label="BrickLink (10%)" value={-scaled.blFees} negative />
            <LineItem label="Amazon (18.3%)" value={-scaled.amazonFees} negative />
            <LineItem label="eBay (20%)" value={-scaled.ebayFees} negative />
          </div>
        )}

        {/* VAT (if registered) - F17 */}
        {isVatRegistered && (
          <LineItem
            label="VAT (Flat Rate)"
            value={-scaled.vatAmount}
            negative
            isBold
          />
        )}

        {/* Other Costs Section */}
        <SectionHeader
          title="Other Costs"
          total={-scaled.totalOtherCosts}
          expanded={expandedSections.otherCosts}
          onToggle={() => toggleSection('otherCosts')}
          negative
        />
        {expandedSections.otherCosts && (
          <div className="ml-6 space-y-1">
            <LineItem label="Fixed Costs" value={-scaled.annualFixedCosts} negative />
            <LineItem label="Postage" value={-scaled.totalPostage} negative />
            <LineItem label="Packaging Materials" value={-scaled.packagingMaterials} negative />
            <LineItem label="Lego Parts" value={-scaled.legoParts} negative />
            <LineItem label="Accountant" value={-scaled.accountantCost} negative />
          </div>
        )}

        <Divider />

        {/* Gross Profit */}
        <LineItem
          label="Gross Profit"
          value={scaled.grossProfit}
          isBold
          highlight={scaled.grossProfit > 0}
        />

        {/* COG Section */}
        <SectionHeader
          title="Cost of Goods (COG)"
          total={-scaled.totalCog}
          expanded={expandedSections.cog}
          onToggle={() => toggleSection('cog')}
          negative
        />
        {expandedSections.cog && (
          <div className="ml-6 space-y-1">
            <LineItem label="BrickLink (20%)" value={-scaled.blCog} negative />
            <LineItem label="Amazon (35%)" value={-scaled.amazonCog} negative />
            <LineItem label="eBay (30%)" value={-scaled.ebayCog} negative />
          </div>
        )}

        <Divider />

        {/* Net Profit */}
        <LineItem
          label="Net Profit"
          value={scaled.netProfit}
          isBold
          isLarge
          highlight={scaled.netProfit > 0}
        />

        {/* Tax Section */}
        <SectionHeader
          title="Tax"
          total={-scaled.totalTax}
          expanded={expandedSections.tax}
          onToggle={() => toggleSection('tax')}
          negative
        />
        {expandedSections.tax && (
          <div className="ml-6 space-y-1">
            <LineItem
              label={`Taxable Income (after £${scaled.taxableIncome > 0 ? Math.round((scaled.netProfit - scaled.taxableIncome)).toLocaleString() : 0} allowance)`}
              value={scaled.taxableIncome}
              muted
            />
            <LineItem label="Income Tax (20%)" value={-scaled.incomeTax} negative />
            <LineItem label="National Insurance (6%)" value={-scaled.nationalInsurance} negative />
          </div>
        )}

        <Divider />

        {/* Take-Home */}
        <LineItem
          label="Take-Home (After Tax)"
          value={scaled.takeHome}
          isBold
          isLarge
          highlight={scaled.takeHome > 0}
        />
        <LineItem
          label="Weekly Take-Home"
          value={scaled.weeklyTakeHome}
          muted
        />
      </CardContent>
    </Card>
  );
}

/**
 * Section header with expandable toggle
 */
interface SectionHeaderProps {
  title: string;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  negative?: boolean;
}

function SectionHeader({
  title,
  total,
  expanded,
  onToggle,
  negative,
}: SectionHeaderProps) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between py-2 hover:bg-muted/50 rounded-lg px-2 transition-colors"
    >
      <div className="flex items-center gap-2">
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="font-medium">{title}</span>
      </div>
      {/* U7: Positive/negative colouring */}
      <span
        className={cn(
          'font-medium',
          negative ? 'text-red-600' : 'text-foreground'
        )}
      >
        {formatCurrency(total)}
      </span>
    </button>
  );
}

/**
 * Line item for individual P&L entry
 */
interface LineItemProps {
  label: string;
  value: number;
  negative?: boolean;
  isBold?: boolean;
  isLarge?: boolean;
  highlight?: boolean;
  muted?: boolean;
}

function LineItem({
  label,
  value,
  negative,
  isBold,
  isLarge,
  highlight,
  muted,
}: LineItemProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between py-1 px-2',
        isLarge && 'py-2'
      )}
    >
      <span
        className={cn(
          'text-sm',
          isBold && 'font-medium',
          muted && 'text-muted-foreground'
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'font-mono',
          isLarge ? 'text-lg' : 'text-sm',
          isBold && 'font-semibold',
          negative && 'text-red-600',
          highlight && value > 0 && 'text-green-600',
          highlight && value < 0 && 'text-red-600',
          muted && 'text-muted-foreground'
        )}
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="border-t my-2" />;
}
