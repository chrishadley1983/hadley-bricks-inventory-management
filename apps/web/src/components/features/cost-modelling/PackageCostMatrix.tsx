/**
 * Package Cost Matrix Component
 * F25-F30: 6-column matrix for package costs
 */

'use client';

import { useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import type { CostModelScenarioFormData, PackageCostFormData, PackageType } from '@/types/cost-modelling';
import { formatCurrency, calculatePackageTotal } from '@/lib/services/cost-calculations';
import { DEFAULT_PACKAGE_COSTS } from '@/types/cost-modelling';

interface PackageCostMatrixProps {
  data: CostModelScenarioFormData;
  fixedCostPerSale: number;
  onChange: (updates: Partial<CostModelScenarioFormData>) => void;
}

const PACKAGE_COLUMNS: { type: PackageType; label: string; platform: 'amazon' | 'ebay' }[] = [
  { type: 'large_parcel_amazon', label: 'Large Parcel', platform: 'amazon' },
  { type: 'small_parcel_amazon', label: 'Small Parcel', platform: 'amazon' },
  { type: 'large_letter_amazon', label: 'Large Letter', platform: 'amazon' },
  { type: 'large_parcel_ebay', label: 'Large Parcel', platform: 'ebay' },
  { type: 'small_parcel_ebay', label: 'Small Parcel', platform: 'ebay' },
  { type: 'large_letter_ebay', label: 'Large Letter', platform: 'ebay' },
];

const COST_ROWS = [
  { key: 'postage' as const, label: 'Postage' },
  { key: 'cardboard' as const, label: 'Cardboard' },
  { key: 'bubbleWrap' as const, label: 'Bubble Wrap' },
  { key: 'legoCard' as const, label: 'Lego Card' },
  { key: 'businessCard' as const, label: 'Business Card' },
];

export function PackageCostMatrix({ data, fixedCostPerSale, onChange }: PackageCostMatrixProps) {
  // Ensure package costs exist, use defaults if not
  const packageCosts = data.packageCosts || DEFAULT_PACKAGE_COSTS;

  // Get cost for a specific package type and cost key
  const getCost = (packageType: PackageType, costKey: keyof Omit<PackageCostFormData, 'id' | 'packageType'>): number => {
    const pkg = packageCosts.find(p => p.packageType === packageType);
    return pkg ? pkg[costKey] : 0;
  };

  // Handle cost change
  const handleCostChange = useCallback((
    packageType: PackageType,
    costKey: keyof Omit<PackageCostFormData, 'id' | 'packageType'>,
    value: string
  ) => {
    const numValue = Math.max(0, parseFloat(value) || 0);

    const updatedCosts = packageCosts.map(pkg => {
      if (pkg.packageType === packageType) {
        return { ...pkg, [costKey]: numValue };
      }
      return pkg;
    });

    // If package type doesn't exist in array, add it
    if (!updatedCosts.find(p => p.packageType === packageType)) {
      const defaultPkg = DEFAULT_PACKAGE_COSTS.find(p => p.packageType === packageType);
      if (defaultPkg) {
        updatedCosts.push({ ...defaultPkg, [costKey]: numValue });
      }
    }

    onChange({ packageCosts: updatedCosts });
  }, [packageCosts, onChange]);

  // Calculate total for a package type (F28)
  const getTotal = (packageType: PackageType): number => {
    const pkg = packageCosts.find(p => p.packageType === packageType);
    if (!pkg) return fixedCostPerSale;
    return calculatePackageTotal(pkg, fixedCostPerSale);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Package Cost Matrix</CardTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">
                  Costs per package type. Total includes fixed cost per sale
                  ({formatCurrency(fixedCostPerSale)}) calculated from monthly fixed costs.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Cost Type</TableHead>
              <TableHead colSpan={3} className="text-center border-l bg-blue-50/50 dark:bg-blue-950/20">
                Amazon
              </TableHead>
              <TableHead colSpan={3} className="text-center border-l bg-orange-50/50 dark:bg-orange-950/20">
                eBay
              </TableHead>
            </TableRow>
            <TableRow>
              <TableHead></TableHead>
              {PACKAGE_COLUMNS.map((col) => (
                <TableHead
                  key={col.type}
                  className={`text-center text-xs ${
                    col.platform === 'amazon'
                      ? 'bg-blue-50/50 dark:bg-blue-950/20'
                      : 'bg-orange-50/50 dark:bg-orange-950/20'
                  } ${col.type.includes('large_parcel') ? 'border-l' : ''}`}
                >
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {COST_ROWS.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{row.label}</TableCell>
                {PACKAGE_COLUMNS.map((col) => (
                  <TableCell
                    key={`${col.type}-${row.key}`}
                    className={`p-1 ${
                      col.platform === 'amazon'
                        ? 'bg-blue-50/30 dark:bg-blue-950/10'
                        : 'bg-orange-50/30 dark:bg-orange-950/10'
                    }`}
                  >
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={getCost(col.type, row.key)}
                      onChange={(e) => handleCostChange(col.type, row.key, e.target.value)}
                      className="h-8 text-right text-sm w-20"
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {/* Fixed cost per sale row (read-only) - F29 */}
            <TableRow>
              <TableCell className="font-medium">
                <div className="flex items-center gap-1">
                  Fixed/Sale
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Monthly fixed costs ÷ total monthly sales</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </TableCell>
              {PACKAGE_COLUMNS.map((col) => (
                <TableCell
                  key={`${col.type}-fixed`}
                  className={`text-center text-sm bg-muted/50 ${
                    col.platform === 'amazon'
                      ? 'bg-blue-100/50 dark:bg-blue-950/30'
                      : 'bg-orange-100/50 dark:bg-orange-950/30'
                  }`}
                >
                  {formatCurrency(fixedCostPerSale)}
                </TableCell>
              ))}
            </TableRow>
            {/* Total row (read-only) - F28 */}
            <TableRow className="font-bold border-t-2">
              <TableCell>Total</TableCell>
              {PACKAGE_COLUMNS.map((col) => (
                <TableCell
                  key={`${col.type}-total`}
                  className={`text-center ${
                    col.platform === 'amazon'
                      ? 'bg-blue-100/50 dark:bg-blue-950/30'
                      : 'bg-orange-100/50 dark:bg-orange-950/30'
                  }`}
                >
                  {formatCurrency(getTotal(col.type))}
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
