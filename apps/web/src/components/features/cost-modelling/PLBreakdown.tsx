'use client';

/**
 * P&L Breakdown Component
 * F23: Shows detailed breakdown of revenue, costs, and profit
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/services/cost-calculations';
import type { CalculatedResults } from '@/types/cost-modelling';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

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

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>P&L Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Revenue Section */}
        <SectionHeader
          title="Revenue (Turnover)"
          total={calculations.totalTurnover}
          expanded={expandedSections.revenue}
          onToggle={() => toggleSection('revenue')}
        />
        {expandedSections.revenue && (
          <div className="ml-6 space-y-1">
            <LineItem label="BrickLink" value={calculations.blTurnover} />
            <LineItem label="Amazon" value={calculations.amazonTurnover} />
            <LineItem label="eBay" value={calculations.ebayTurnover} />
          </div>
        )}

        {/* Platform Fees Section */}
        <SectionHeader
          title="Platform Fees"
          total={-calculations.totalFees}
          expanded={expandedSections.fees}
          onToggle={() => toggleSection('fees')}
          negative
        />
        {expandedSections.fees && (
          <div className="ml-6 space-y-1">
            <LineItem label="BrickLink (10%)" value={-calculations.blFees} negative />
            <LineItem label="Amazon (18.3%)" value={-calculations.amazonFees} negative />
            <LineItem label="eBay (20%)" value={-calculations.ebayFees} negative />
          </div>
        )}

        {/* VAT (if registered) - F17 */}
        {isVatRegistered && (
          <LineItem
            label="VAT (Flat Rate)"
            value={-calculations.vatAmount}
            negative
            isBold
          />
        )}

        {/* Other Costs Section */}
        <SectionHeader
          title="Other Costs"
          total={-calculations.totalOtherCosts}
          expanded={expandedSections.otherCosts}
          onToggle={() => toggleSection('otherCosts')}
          negative
        />
        {expandedSections.otherCosts && (
          <div className="ml-6 space-y-1">
            <LineItem label="Fixed Costs (Annual)" value={-calculations.annualFixedCosts} negative />
            <LineItem label="Postage" value={-calculations.totalPostage} negative />
            <LineItem label="Packaging Materials" value={-calculations.packagingMaterials} negative />
            <LineItem label="Lego Parts" value={-calculations.legoParts} negative />
            <LineItem label="Accountant" value={-calculations.accountantCost} negative />
          </div>
        )}

        <Divider />

        {/* Gross Profit */}
        <LineItem
          label="Gross Profit"
          value={calculations.grossProfit}
          isBold
          highlight={calculations.grossProfit > 0}
        />

        {/* COG Section */}
        <SectionHeader
          title="Cost of Goods (COG)"
          total={-calculations.totalCog}
          expanded={expandedSections.cog}
          onToggle={() => toggleSection('cog')}
          negative
        />
        {expandedSections.cog && (
          <div className="ml-6 space-y-1">
            <LineItem label="BrickLink (20%)" value={-calculations.blCog} negative />
            <LineItem label="Amazon (35%)" value={-calculations.amazonCog} negative />
            <LineItem label="eBay (30%)" value={-calculations.ebayCog} negative />
          </div>
        )}

        <Divider />

        {/* Net Profit */}
        <LineItem
          label="Net Profit"
          value={calculations.netProfit}
          isBold
          isLarge
          highlight={calculations.netProfit > 0}
        />

        {/* Tax Section */}
        <SectionHeader
          title="Tax"
          total={-calculations.totalTax}
          expanded={expandedSections.tax}
          onToggle={() => toggleSection('tax')}
          negative
        />
        {expandedSections.tax && (
          <div className="ml-6 space-y-1">
            <LineItem
              label={`Taxable Income (after £${calculations.taxableIncome > 0 ? (calculations.netProfit - calculations.taxableIncome).toLocaleString() : 0} allowance)`}
              value={calculations.taxableIncome}
              muted
            />
            <LineItem label="Income Tax (20%)" value={-calculations.incomeTax} negative />
            <LineItem label="National Insurance (6%)" value={-calculations.nationalInsurance} negative />
          </div>
        )}

        <Divider />

        {/* Take-Home */}
        <LineItem
          label="Take-Home (After Tax)"
          value={calculations.takeHome}
          isBold
          isLarge
          highlight={calculations.takeHome > 0}
        />
        <LineItem
          label="Weekly Take-Home"
          value={calculations.weeklyTakeHome}
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
