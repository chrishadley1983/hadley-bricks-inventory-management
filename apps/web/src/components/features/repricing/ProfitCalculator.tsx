'use client';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { calculateAmazonFBMProfit } from '@/lib/arbitrage/calculations';
import { cn } from '@/lib/utils';

interface ProfitCalculatorProps {
  salePrice: number;
  productCost: number | null;
  className?: string;
}

/**
 * Inline profit display with breakdown tooltip
 */
export function ProfitCalculator({ salePrice, productCost, className }: ProfitCalculatorProps) {
  // Can't calculate without cost
  if (productCost === null || productCost <= 0) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }

  const breakdown = calculateAmazonFBMProfit(salePrice, productCost);

  if (!breakdown) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }

  const isProfit = breakdown.totalProfit >= 0;
  const profitColor = isProfit ? 'text-green-600' : 'text-red-600';

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
    }).format(amount);

  const formatPercent = (percent: number) => {
    const sign = percent >= 0 ? '+' : '';
    return `${sign}${percent.toFixed(1)}%`;
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'font-mono cursor-help underline decoration-dotted',
              profitColor,
              className
            )}
          >
            {formatCurrency(breakdown.totalProfit)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="w-64 p-3">
          <div className="space-y-2 text-xs">
            <div className="font-semibold text-sm border-b pb-1 mb-2">Profit Breakdown</div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">Sale Price:</span>
              <span className="font-mono">{formatCurrency(salePrice)}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">Referral Fee (15%):</span>
              <span className="font-mono text-red-600">
                -{formatCurrency(breakdown.referralFee)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">DST (2%):</span>
              <span className="font-mono text-red-600">
                -{formatCurrency(breakdown.digitalServicesTax)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">VAT on Fees (20%):</span>
              <span className="font-mono text-red-600">-{formatCurrency(breakdown.vatOnFees)}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">Shipping:</span>
              <span className="font-mono text-red-600">
                -{formatCurrency(breakdown.shippingCost)}
              </span>
            </div>

            <div className="flex justify-between border-t pt-1">
              <span className="text-muted-foreground">Net Payout:</span>
              <span className="font-mono">{formatCurrency(breakdown.netPayout)}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">Product Cost:</span>
              <span className="font-mono text-red-600">-{formatCurrency(productCost)}</span>
            </div>

            <div className="flex justify-between border-t pt-1 font-semibold">
              <span>Total Profit:</span>
              <span className={cn('font-mono', profitColor)}>
                {formatCurrency(breakdown.totalProfit)}
              </span>
            </div>

            <div className="flex justify-between text-muted-foreground">
              <span>ROI:</span>
              <span className={cn('font-mono', profitColor)}>
                {formatPercent(breakdown.roiPercent)}
              </span>
            </div>

            <div className="border-t pt-1 mt-1 space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>COG %:</span>
                <span className="font-mono">{((productCost / salePrice) * 100).toFixed(1)}%</span>
              </div>

              <div className="flex justify-between text-muted-foreground">
                <span>Profit Margin:</span>
                <span className={cn('font-mono', profitColor)}>
                  {formatPercent(breakdown.profitMarginPercent)}
                </span>
              </div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
