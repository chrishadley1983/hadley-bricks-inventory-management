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

  // F33: Weekly view calculations (aligned with daily format)
  const weeklyData = [
    {
      platform: 'BrickLink',
      salesPerWeek: (data.blSalesPerMonth * 12) / 52,
      cogPerItem: calculations.blCogPerItem,
      salePrice: data.blAvgSaleValue,
      salePriceExcPostage: data.blAvgSaleValue - data.blAvgPostageCost,
      turnoverPerWeek: calculations.blTurnover / 52,
      cogBudgetPerWeek: calculations.blCogBudgetPerWeek,
    },
    {
      platform: 'Amazon',
      salesPerWeek: (data.amazonSalesPerMonth * 12) / 52,
      cogPerItem: calculations.amazonCogPerItem,
      salePrice: data.amazonAvgSaleValue,
      salePriceExcPostage: data.amazonAvgSaleValue - data.amazonAvgPostageCost,
      turnoverPerWeek: calculations.amazonTurnover / 52,
      cogBudgetPerWeek: calculations.amazonCogBudgetPerWeek,
    },
    {
      platform: 'eBay',
      salesPerWeek: (data.ebaySalesPerMonth * 12) / 52,
      cogPerItem: calculations.ebayCogPerItem,
      salePrice: data.ebayAvgSaleValue,
      salePriceExcPostage: data.ebayAvgSaleValue - data.ebayAvgPostageCost,
      turnoverPerWeek: calculations.ebayTurnover / 52,
      cogBudgetPerWeek: calculations.ebayCogBudgetPerWeek,
    },
    {
      platform: 'Total',
      salesPerWeek: calculations.salesPerWeek,
      cogPerItem: calculations.totalCog / calculations.totalAnnualSales,
      salePrice: calculations.totalTurnover / calculations.totalAnnualSales,
      salePriceExcPostage:
        (calculations.totalTurnover - calculations.totalPostage) / calculations.totalAnnualSales,
      turnoverPerWeek: calculations.turnoverPerWeek,
      cogBudgetPerWeek: calculations.cogBudgetPerWeek,
    },
  ];

  // F34: Monthly view calculations (aligned with daily format)
  const monthlyData = [
    {
      platform: 'BrickLink',
      salesPerMonth: data.blSalesPerMonth,
      cogPerItem: calculations.blCogPerItem,
      salePrice: data.blAvgSaleValue,
      salePriceExcPostage: data.blAvgSaleValue - data.blAvgPostageCost,
      turnoverPerMonth: calculations.blTurnover / 12,
      cogBudgetPerMonth: calculations.blCog / 12,
    },
    {
      platform: 'Amazon',
      salesPerMonth: data.amazonSalesPerMonth,
      cogPerItem: calculations.amazonCogPerItem,
      salePrice: data.amazonAvgSaleValue,
      salePriceExcPostage: data.amazonAvgSaleValue - data.amazonAvgPostageCost,
      turnoverPerMonth: calculations.amazonTurnover / 12,
      cogBudgetPerMonth: calculations.amazonCog / 12,
    },
    {
      platform: 'eBay',
      salesPerMonth: data.ebaySalesPerMonth,
      cogPerItem: calculations.ebayCogPerItem,
      salePrice: data.ebayAvgSaleValue,
      salePriceExcPostage: data.ebayAvgSaleValue - data.ebayAvgPostageCost,
      turnoverPerMonth: calculations.ebayTurnover / 12,
      cogBudgetPerMonth: calculations.ebayCog / 12,
    },
    {
      platform: 'Total',
      salesPerMonth: calculations.totalMonthlySales,
      cogPerItem: calculations.totalCog / calculations.totalAnnualSales,
      salePrice: calculations.totalTurnover / calculations.totalAnnualSales,
      salePriceExcPostage:
        (calculations.totalTurnover - calculations.totalPostage) / calculations.totalAnnualSales,
      turnoverPerMonth: calculations.totalTurnover / 12,
      cogBudgetPerMonth: calculations.totalCog / 12,
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
                    <TableHead className="text-right">Sales/Week</TableHead>
                    <TableHead className="text-right">COG/Item</TableHead>
                    <TableHead className="text-right">Sale Price</TableHead>
                    <TableHead className="text-right">Exc. Postage</TableHead>
                    <TableHead className="text-right">Turnover/Week</TableHead>
                    <TableHead className="text-right">COG Budget/Week</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeklyData.map((row) => (
                    <TableRow
                      key={row.platform}
                      className={row.platform === 'Total' ? 'font-bold border-t-2' : ''}
                    >
                      <TableCell className="font-medium">{row.platform}</TableCell>
                      <TableCell className="text-right">{row.salesPerWeek.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.cogPerItem)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.salePrice)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.salePriceExcPostage)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.turnoverPerWeek)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.cogBudgetPerWeek)}</TableCell>
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
                    <TableHead className="text-right">Sales/Month</TableHead>
                    <TableHead className="text-right">COG/Item</TableHead>
                    <TableHead className="text-right">Sale Price</TableHead>
                    <TableHead className="text-right">Exc. Postage</TableHead>
                    <TableHead className="text-right">Turnover/Month</TableHead>
                    <TableHead className="text-right">COG Budget/Month</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyData.map((row) => (
                    <TableRow
                      key={row.platform}
                      className={row.platform === 'Total' ? 'font-bold border-t-2' : ''}
                    >
                      <TableCell className="font-medium">{row.platform}</TableCell>
                      <TableCell className="text-right">{row.salesPerMonth.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.cogPerItem)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.salePrice)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.salePriceExcPostage)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.turnoverPerMonth)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.cogBudgetPerMonth)}</TableCell>
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
