'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  Calculator,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

interface SaleItem {
  id: string;
  itemNumber: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
}

interface CreateSaleInput {
  saleDate: string;
  platform: string;
  saleAmount: number;
  shippingCharged: number;
  platformFees: number;
  shippingCost: number;
  otherCosts: number;
  costOfGoods: number;
  buyerName?: string;
  buyerEmail?: string;
  description?: string;
  notes?: string;
  items?: Array<{
    itemNumber: string;
    itemName: string;
    quantity: number;
    unitPrice: number;
    unitCost: number;
  }>;
}

async function createSale(input: CreateSaleInput): Promise<{ data: { id: string } }> {
  const response = await fetch('/api/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to create sale');
  }
  return response.json();
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

export default function NewSalePage() {
  const router = useRouter();
  const { toast } = useToast();

  // Form state
  const [saleDate, setSaleDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [platform, setPlatform] = useState('manual');
  const [saleAmount, setSaleAmount] = useState<string>('');
  const [shippingCharged, setShippingCharged] = useState<string>('0');
  const [platformFees, setPlatformFees] = useState<string>('0');
  const [shippingCost, setShippingCost] = useState<string>('0');
  const [otherCosts, setOtherCosts] = useState<string>('0');
  const [costOfGoods, setCostOfGoods] = useState<string>('0');
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');

  // Line items
  const [items, setItems] = useState<SaleItem[]>([]);
  const [showItems, setShowItems] = useState(false);

  const createMutation = useMutation({
    mutationFn: createSale,
    onSuccess: () => {
      toast({
        title: 'Sale recorded',
        description: 'The sale has been successfully recorded.',
      });
      router.push('/sales');
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create sale',
        variant: 'destructive',
      });
    },
  });

  // Calculate totals
  const saleAmountNum = parseFloat(saleAmount) || 0;
  const shippingChargedNum = parseFloat(shippingCharged) || 0;
  const platformFeesNum = parseFloat(platformFees) || 0;
  const shippingCostNum = parseFloat(shippingCost) || 0;
  const otherCostsNum = parseFloat(otherCosts) || 0;
  const costOfGoodsNum = parseFloat(costOfGoods) || 0;

  const totalRevenue = saleAmountNum + shippingChargedNum;
  const totalCosts = platformFeesNum + shippingCostNum + otherCostsNum + costOfGoodsNum;
  const grossProfit = totalRevenue - totalCosts;
  const margin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  const handleAddItem = () => {
    setItems([
      ...items,
      {
        id: crypto.randomUUID(),
        itemNumber: '',
        itemName: '',
        quantity: 1,
        unitPrice: 0,
        unitCost: 0,
      },
    ]);
    setShowItems(true);
  };

  const handleUpdateItem = (id: string, field: keyof SaleItem, value: string | number) => {
    setItems(
      items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const handleRemoveItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!saleAmount || saleAmountNum <= 0) {
      toast({
        title: 'Validation error',
        description: 'Please enter a valid sale amount',
        variant: 'destructive',
      });
      return;
    }

    const input: CreateSaleInput = {
      saleDate,
      platform,
      saleAmount: saleAmountNum,
      shippingCharged: shippingChargedNum,
      platformFees: platformFeesNum,
      shippingCost: shippingCostNum,
      otherCosts: otherCostsNum,
      costOfGoods: costOfGoodsNum,
      buyerName: buyerName || undefined,
      buyerEmail: buyerEmail || undefined,
      description: description || undefined,
      notes: notes || undefined,
      items: items.length > 0 ? items.map(({ id: _id, ...item }) => item) : undefined,
    };

    createMutation.mutate(input);
  };

  return (
    <>
      <Header title="Add Manual Sale" />
      <div className="p-6 space-y-6 max-w-3xl">
        {/* Back Button */}
        <div className="flex items-center gap-4">
          <Link href="/sales">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Sales
            </Button>
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle>Sale Details</CardTitle>
              <CardDescription>
                Enter the basic information about this sale
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="saleDate">Sale Date</Label>
                  <Input
                    id="saleDate"
                    type="date"
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="platform">Platform</Label>
                  <Select value={platform} onValueChange={setPlatform}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select platform" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual / In-Person</SelectItem>
                      <SelectItem value="bricklink">BrickLink</SelectItem>
                      <SelectItem value="brickowl">BrickOwl</SelectItem>
                      <SelectItem value="ebay">eBay</SelectItem>
                      <SelectItem value="amazon">Amazon</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="buyerName">Buyer Name (optional)</Label>
                  <Input
                    id="buyerName"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    placeholder="Customer name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="buyerEmail">Buyer Email (optional)</Label>
                  <Input
                    id="buyerEmail"
                    type="email"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    placeholder="customer@example.com"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of the sale"
                />
              </div>
            </CardContent>
          </Card>

          {/* Amounts */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Amounts & Costs
              </CardTitle>
              <CardDescription>
                Enter the sale amount and all associated costs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="saleAmount">Sale Amount *</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-muted-foreground">£</span>
                    <Input
                      id="saleAmount"
                      type="number"
                      step="0.01"
                      min="0"
                      value={saleAmount}
                      onChange={(e) => setSaleAmount(e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="shippingCharged">Shipping Charged</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-muted-foreground">£</span>
                    <Input
                      id="shippingCharged"
                      type="number"
                      step="0.01"
                      min="0"
                      value={shippingCharged}
                      onChange={(e) => setShippingCharged(e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                </div>
              </div>

              <Separator />
              <p className="text-sm font-medium text-muted-foreground">Costs</p>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="costOfGoods">Cost of Goods</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-muted-foreground">£</span>
                    <Input
                      id="costOfGoods"
                      type="number"
                      step="0.01"
                      min="0"
                      value={costOfGoods}
                      onChange={(e) => setCostOfGoods(e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="platformFees">Platform Fees</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-muted-foreground">£</span>
                    <Input
                      id="platformFees"
                      type="number"
                      step="0.01"
                      min="0"
                      value={platformFees}
                      onChange={(e) => setPlatformFees(e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="shippingCost">Shipping Cost</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-muted-foreground">£</span>
                    <Input
                      id="shippingCost"
                      type="number"
                      step="0.01"
                      min="0"
                      value={shippingCost}
                      onChange={(e) => setShippingCost(e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="otherCosts">Other Costs</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-muted-foreground">£</span>
                    <Input
                      id="otherCosts"
                      type="number"
                      step="0.01"
                      min="0"
                      value={otherCosts}
                      onChange={(e) => setOtherCosts(e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Summary */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Total Revenue</span>
                  <span className="font-medium">{formatCurrency(totalRevenue)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Total Costs</span>
                  <span className="font-medium text-muted-foreground">
                    -{formatCurrency(totalCosts)}
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="font-medium">Gross Profit</span>
                  <span
                    className={`font-bold ${
                      grossProfit >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {formatCurrency(grossProfit)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Margin</span>
                  <span
                    className={margin >= 0 ? 'text-green-600' : 'text-red-600'}
                  >
                    {margin.toFixed(1)}%
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line Items (Optional) */}
          <Card>
            <CardHeader>
              <CardTitle>Line Items (Optional)</CardTitle>
              <CardDescription>
                Add individual items sold in this transaction
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {showItems && items.length > 0 && (
                <div className="space-y-4">
                  {items.map((item, index) => (
                    <div
                      key={item.id}
                      className="grid gap-2 md:grid-cols-6 items-end border-b pb-4"
                    >
                      <div className="md:col-span-2 space-y-1">
                        <Label className="text-xs">Item #{index + 1}</Label>
                        <Input
                          placeholder="Item number"
                          value={item.itemNumber}
                          onChange={(e) =>
                            handleUpdateItem(item.id, 'itemNumber', e.target.value)
                          }
                        />
                        <Input
                          placeholder="Item name"
                          value={item.itemName}
                          onChange={(e) =>
                            handleUpdateItem(item.id, 'itemName', e.target.value)
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Qty</Label>
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) =>
                            handleUpdateItem(
                              item.id,
                              'quantity',
                              parseInt(e.target.value) || 1
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Unit Price</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.unitPrice}
                          onChange={(e) =>
                            handleUpdateItem(
                              item.id,
                              'unitPrice',
                              parseFloat(e.target.value) || 0
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Unit Cost</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.unitCost}
                          onChange={(e) =>
                            handleUpdateItem(
                              item.id,
                              'unitCost',
                              parseFloat(e.target.value) || 0
                            )
                          }
                        />
                      </div>
                      <div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveItem(item.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={handleAddItem}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>Notes (Optional)</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional notes about this sale..."
                rows={3}
              />
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex justify-end gap-4">
            <Link href="/sales">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Record Sale
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
