'use client';

import * as React from 'react';
import { ArrowLeft, ArrowRight, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import type {
  EvaluationInputItem,
  TargetPlatform,
  CostAllocationMethod,
} from '@/lib/purchase-evaluator';

interface ParseStepProps {
  items: EvaluationInputItem[];
  onItemsChange: (items: EvaluationInputItem[]) => void;
  evaluationName: string;
  onEvaluationNameChange: (name: string) => void;
  defaultPlatform: TargetPlatform;
  onDefaultPlatformChange: (platform: TargetPlatform) => void;
  totalPurchasePrice: number | undefined;
  onTotalPurchasePriceChange: (price: number | undefined) => void;
  costAllocationMethod: CostAllocationMethod;
  onCostAllocationMethodChange: (method: CostAllocationMethod) => void;
  onBack: () => void;
  onProceed: () => void;
  isLoading: boolean;
}

/**
 * Parse/preview step for the purchase evaluator wizard
 * Shows parsed items and allows configuration
 */
export function ParseStep({
  items,
  onItemsChange,
  evaluationName,
  onEvaluationNameChange,
  defaultPlatform,
  onDefaultPlatformChange,
  totalPurchasePrice,
  onTotalPurchasePriceChange,
  costAllocationMethod,
  onCostAllocationMethodChange,
  onBack,
  onProceed,
  isLoading,
}: ParseStepProps) {
  // Calculate summary
  const totalQuantity = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const itemsWithCost = items.filter((item) => item.cost !== undefined).length;
  const totalCost = items.reduce((sum, item) => {
    if (item.cost === undefined) return sum;
    return sum + item.cost * (item.quantity || 1);
  }, 0);

  // Determine cost method based on input
  const hasPerItemCosts = itemsWithCost > 0;

  // Remove an item
  const handleRemoveItem = (index: number) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    onItemsChange(newItems);
  };

  // Update item quantity
  const handleQuantityChange = (index: number, quantity: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], quantity };
    onItemsChange(newItems);
  };

  // Update item cost
  const handleCostChange = (index: number, cost: number | undefined) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], cost };
    onItemsChange(newItems);
  };

  return (
    <div className="space-y-6">
      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Configure evaluation settings before running lookups
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Evaluation name */}
            <div className="space-y-2">
              <Label htmlFor="name">Evaluation Name (Optional)</Label>
              <Input
                id="name"
                placeholder="e.g., Facebook Marketplace Lot"
                value={evaluationName}
                onChange={(e) => onEvaluationNameChange(e.target.value)}
              />
            </div>

            {/* Default platform */}
            <div className="space-y-2">
              <Label htmlFor="platform">Default Selling Platform</Label>
              <Select value={defaultPlatform} onValueChange={(v: string) => onDefaultPlatformChange(v as TargetPlatform)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="amazon">Amazon</SelectItem>
                  <SelectItem value="ebay">eBay</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Cost allocation */}
          <div className="space-y-4">
            <Label>Cost Allocation</Label>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Select
                  value={costAllocationMethod}
                  onValueChange={(v: string) => onCostAllocationMethodChange(v as CostAllocationMethod)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_item">Per-Item Costs (from data)</SelectItem>
                    <SelectItem value="proportional">Proportional (by Listing Price)</SelectItem>
                    <SelectItem value="equal">Equal Split</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {costAllocationMethod === 'per_item' && 'Use costs from imported data'}
                  {costAllocationMethod === 'proportional' && 'Allocate based on Amazon Buy Box / Was Price ratios'}
                  {costAllocationMethod === 'equal' && 'Split total cost equally among items'}
                </p>
              </div>

              {/* Total purchase price (for proportional/equal) */}
              {costAllocationMethod !== 'per_item' && (
                <div className="space-y-2">
                  <Label htmlFor="totalPrice">Total Purchase Price</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      £
                    </span>
                    <Input
                      id="totalPrice"
                      type="number"
                      step="0.01"
                      min="0"
                      className="pl-7"
                      placeholder="0.00"
                      value={totalPurchasePrice || ''}
                      onChange={(e) => onTotalPurchasePriceChange(
                        e.target.value ? parseFloat(e.target.value) : undefined
                      )}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-2xl font-bold">{items.length}</p>
              <p className="text-sm text-muted-foreground">Unique Sets</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{totalQuantity}</p>
              <p className="text-sm text-muted-foreground">Total Items</p>
            </div>
            {hasPerItemCosts && (
              <div>
                <p className="text-2xl font-bold">£{totalCost.toFixed(2)}</p>
                <p className="text-sm text-muted-foreground">Total Cost</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Items table */}
      <Card>
        <CardHeader>
          <CardTitle>Items to Evaluate ({items.length})</CardTitle>
          <CardDescription>
            Review and edit items before running lookups
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px] w-full">
            <div className="min-w-[800px] rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Set #</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[80px]">Condition</TableHead>
                    <TableHead className="w-[80px]">Qty</TableHead>
                    <TableHead className="w-[100px]">Cost</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={`${item.setNumber}-${item.condition}-${index}`}>
                      <TableCell className="font-mono">{item.setNumber}</TableCell>
                      <TableCell>{item.setName || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={item.condition === 'New' ? 'default' : 'secondary'}>
                          {item.condition}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="1"
                          className="w-16 h-8"
                          value={item.quantity || 1}
                          onChange={(e) => handleQuantityChange(index, parseInt(e.target.value) || 1)}
                        />
                      </TableCell>
                      <TableCell>
                        {costAllocationMethod === 'per_item' ? (
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                              £
                            </span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="w-24 h-8 pl-5"
                              value={item.cost ?? ''}
                              onChange={(e) => handleCostChange(
                                index,
                                e.target.value ? parseFloat(e.target.value) : undefined
                              )}
                            />
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleRemoveItem(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={onProceed}
          disabled={items.length === 0 || isLoading || (costAllocationMethod !== 'per_item' && !totalPurchasePrice)}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              Run Lookups
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
