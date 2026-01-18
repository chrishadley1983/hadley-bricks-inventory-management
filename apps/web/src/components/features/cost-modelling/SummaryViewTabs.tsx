/**
 * Summary View Tabs Component
 * F31-F34: Daily, Weekly, Monthly summary views
 */

'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { CostModelScenarioFormData, CalculatedResults } from '@/types/cost-modelling';
import { formatCurrency } from '@/lib/services/cost-calculations';

interface SummaryViewTabsProps {
  calculations: CalculatedResults;
  data: CostModelScenarioFormData;
}

export function SummaryViewTabs({ calculations, data }: SummaryViewTabsProps) {
  // F32: Daily view calculations
  const dailyData = [
    {
      platform: 'BrickLink',
      salesPerDay: calculations.blSalesPerDay,
      cogPerItem: calculations.blCogPerItem,
      salePrice: data.blAvgSaleValue,
      salePriceExcPostage: data.blAvgSaleValue - data.blAvgPostageCost,
      turnoverPerDay: calculations.blTurnoverPerDay,
      cogBudgetPerDay: calculations.blCogBudgetPerDay,
    },
    {
      platform: 'Amazon',
      salesPerDay: calculations.amazonSalesPerDay,
      cogPerItem: calculations.amazonCogPerItem,
      salePrice: data.amazonAvgSaleValue,
      salePriceExcPostage: data.amazonAvgSaleValue - data.amazonAvgPostageCost,
      turnoverPerDay: calculations.amazonTurnoverPerDay,
      cogBudgetPerDay: calculations.amazonCogBudgetPerDay,
    },
    {
      platform: 'eBay',
      salesPerDay: calculations.ebaySalesPerDay,
      cogPerItem: calculations.ebayCogPerItem,
      salePrice: data.ebayAvgSaleValue,
      salePriceExcPostage: data.ebayAvgSaleValue - data.ebayAvgPostageCost,
      turnoverPerDay: calculations.ebayTurnoverPerDay,
      cogBudgetPerDay: calculations.ebayCogBudgetPerDay,
    },
    {
      platform: 'Total',
      salesPerDay: calculations.salesPerDay,
      cogPerItem: calculations.totalCog / calculations.totalAnnualSales,
      salePrice: calculations.totalTurnover / calculations.totalAnnualSales,
      salePriceExcPostage:
        (calculations.totalTurnover - calculations.totalPostage) / calculations.totalAnnualSales,
      turnoverPerDay: calculations.turnoverPerDay,
      cogBudgetPerDay: calculations.cogBudgetPerDay,
    },
  ];

  // F33: Weekly view calculations
  const weeklyData = [
    {
      platform: 'BrickLink',
      cogBudget: calculations.blCogBudgetPerWeek,
      salesTarget: calculations.blTurnover / 52,
      salesVolume: (data.blSalesPerMonth * 12) / 52,
    },
    {
      platform: 'Amazon',
      cogBudget: calculations.amazonCogBudgetPerWeek,
      salesTarget: calculations.amazonTurnover / 52,
      salesVolume: (data.amazonSalesPerMonth * 12) / 52,
    },
    {
      platform: 'eBay',
      cogBudget: calculations.ebayCogBudgetPerWeek,
      salesTarget: calculations.ebayTurnover / 52,
      salesVolume: (data.ebaySalesPerMonth * 12) / 52,
    },
    {
      platform: 'Total',
      cogBudget: calculations.cogBudgetPerWeek,
      salesTarget: calculations.turnoverPerWeek,
      salesVolume: calculations.salesPerWeek,
    },
  ];

  // F34: Monthly view calculations (matching assumption inputs)
  const monthlyData = [
    {
      platform: 'BrickLink',
      cogBudget: calculations.blCog / 12,
      salesTarget: calculations.blTurnover / 12,
      salesVolume: data.blSalesPerMonth,
    },
    {
      platform: 'Amazon',
      cogBudget: calculations.amazonCog / 12,
      salesTarget: calculations.amazonTurnover / 12,
      salesVolume: data.amazonSalesPerMonth,
    },
    {
      platform: 'eBay',
      cogBudget: calculations.ebayCog / 12,
      salesTarget: calculations.ebayTurnover / 12,
      salesVolume: data.ebaySalesPerMonth,
    },
    {
      platform: 'Total',
      cogBudget: calculations.totalCog / 12,
      salesTarget: calculations.totalTurnover / 12,
      salesVolume: calculations.totalMonthlySales,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Summary Views</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="daily">
          <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
          </TabsList>

          {/* F32: Daily View */}
          <TabsContent value="daily" className="mt-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Platform</TableHead>
                    <TableHead className="text-right">Sales/Day</TableHead>
                    <TableHead className="text-right">COG/Item</TableHead>
                    <TableHead className="text-right">Sale Price</TableHead>
                    <TableHead className="text-right">Exc. Postage</TableHead>
                    <TableHead className="text-right">Turnover/Day</TableHead>
                    <TableHead className="text-right">COG Budget/Day</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dailyData.map((row) => (
                    <TableRow
                      key={row.platform}
                      className={row.platform === 'Total' ? 'font-bold border-t-2' : ''}
                    >
                      <TableCell className="font-medium">{row.platform}</TableCell>
                      <TableCell className="text-right">{row.salesPerDay.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.cogPerItem)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.salePrice)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.salePriceExcPostage)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.turnoverPerDay)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.cogBudgetPerDay)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* F33: Weekly View */}
          <TabsContent value="weekly" className="mt-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Platform</TableHead>
                    <TableHead className="text-right">COG Budget</TableHead>
                    <TableHead className="text-right">Sales Target</TableHead>
                    <TableHead className="text-right">Sales Volume</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeklyData.map((row) => (
                    <TableRow
                      key={row.platform}
                      className={row.platform === 'Total' ? 'font-bold border-t-2' : ''}
                    >
                      <TableCell className="font-medium">{row.platform}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.cogBudget)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.salesTarget)}</TableCell>
                      <TableCell className="text-right">{row.salesVolume.toFixed(1)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* F34: Monthly View */}
          <TabsContent value="monthly" className="mt-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Platform</TableHead>
                    <TableHead className="text-right">COG Budget</TableHead>
                    <TableHead className="text-right">Sales Target</TableHead>
                    <TableHead className="text-right">Sales Volume</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyData.map((row) => (
                    <TableRow
                      key={row.platform}
                      className={row.platform === 'Total' ? 'font-bold border-t-2' : ''}
                    >
                      <TableCell className="font-medium">{row.platform}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.cogBudget)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.salesTarget)}</TableCell>
                      <TableCell className="text-right">{row.salesVolume}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
