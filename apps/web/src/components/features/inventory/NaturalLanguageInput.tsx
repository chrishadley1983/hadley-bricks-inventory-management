'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, Plus, Trash2, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useParseInventory } from '@/hooks/use-parse-inventory';
import type { ParsedInventoryItem } from '@/lib/ai';

const STATUS_OPTIONS = [
  { value: 'NOT YET RECEIVED', label: 'Not Yet Received' },
  { value: 'BACKLOG', label: 'Backlog' },
  { value: 'LISTED', label: 'Listed' },
  { value: 'SOLD', label: 'Sold' },
];

const CONDITION_OPTIONS = [
  { value: 'New', label: 'New' },
  { value: 'Used', label: 'Used' },
];

interface EditableItem extends ParsedInventoryItem {
  id: string;
  listing_date?: string;
  listing_value?: number;
  storage_location?: string;
  sku?: string;
  linked_lot?: string;
  listing_platform?: string;
  amazon_asin?: string;
}

interface SharedFields {
  source: string;
  purchase_date: string;
  condition: 'New' | 'Used' | '';
  status: string;
  storage_location: string;
  listing_platform: string;
  listing_date: string;
  listing_value: string;
  sku: string;
  linked_lot: string;
  amazon_asin: string;
}

/**
 * Natural Language Input component for AI-powered inventory parsing
 */
export function NaturalLanguageInput() {
  const router = useRouter();
  const parseInventory = useParseInventory();

  // Input state
  const [inputText, setInputText] = React.useState('');
  const [isCreating, setIsCreating] = React.useState(false);

  // Preview state
  const [parsedItems, setParsedItems] = React.useState<EditableItem[]>([]);
  const [sharedFields, setSharedFields] = React.useState<SharedFields>({
    source: '',
    purchase_date: '',
    condition: '',
    status: 'NOT YET RECEIVED',
    storage_location: '',
    listing_platform: '',
    listing_date: '',
    listing_value: '',
    sku: '',
    linked_lot: '',
    amazon_asin: '',
  });
  const [showPreview, setShowPreview] = React.useState(false);

  // Parse the input text
  const handleParse = async () => {
    if (!inputText.trim()) return;

    try {
      const result = await parseInventory.mutateAsync(inputText);

      // Convert parsed items to editable format with unique IDs
      const editableItems: EditableItem[] = result.items.map((item, index) => ({
        ...item,
        id: `item-${index}-${Date.now()}`,
      }));

      setParsedItems(editableItems);

      // Set shared fields from response
      if (result.shared_fields) {
        setSharedFields({
          source: result.shared_fields.source || '',
          purchase_date: result.shared_fields.purchase_date || '',
          condition: result.shared_fields.condition || '',
          status: 'NOT YET RECEIVED',
          storage_location: '',
          listing_platform: '',
          listing_date: '',
          listing_value: '',
          sku: '',
          linked_lot: '',
          amazon_asin: '',
        });
      }

      setShowPreview(true);
    } catch (error) {
      console.error('Failed to parse inventory:', error);
    }
  };

  // Update a single item field
  const updateItem = (id: string, field: keyof EditableItem, value: string | number) => {
    setParsedItems((items) =>
      items.map((item) =>
        item.id === id
          ? { ...item, [field]: value }
          : item
      )
    );
  };

  // Remove an item from the list
  const removeItem = (id: string) => {
    setParsedItems((items) => items.filter((item) => item.id !== id));
  };

  // Add a new empty item
  const addItem = () => {
    const newItem: EditableItem = {
      id: `item-new-${Date.now()}`,
      set_number: '',
      quantity: 1,
      confidence: 1,
      item_name: '',
      condition: undefined,
      cost: undefined,
      source: undefined,
      notes: undefined,
      storage_location: '',
      listing_platform: '',
      listing_date: '',
      listing_value: undefined,
      sku: '',
      linked_lot: '',
      amazon_asin: '',
    };
    setParsedItems((items) => [...items, newItem]);
  };

  // Calculate total items (accounting for quantities)
  const totalItems = React.useMemo(() => {
    return parsedItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
  }, [parsedItems]);

  // Create all items
  const handleCreate = async () => {
    if (parsedItems.length === 0) return;

    setIsCreating(true);

    // Expand items by quantity and merge shared fields
    const itemsToCreate = parsedItems.flatMap((item) => {
      const quantity = item.quantity || 1;
      const listingValue = item.listing_value || (sharedFields.listing_value ? parseFloat(sharedFields.listing_value) : undefined);
      const baseItem = {
        set_number: item.set_number,
        item_name: item.item_name,
        condition: item.condition || sharedFields.condition || undefined,
        status: item.status || sharedFields.status || 'NOT YET RECEIVED',
        cost: item.cost,
        source: item.source || sharedFields.source || undefined,
        purchase_date: sharedFields.purchase_date || undefined,
        storage_location: item.storage_location || sharedFields.storage_location || undefined,
        listing_platform: item.listing_platform || sharedFields.listing_platform || undefined,
        listing_date: item.listing_date || sharedFields.listing_date || undefined,
        listing_value: listingValue,
        sku: item.sku || sharedFields.sku || undefined,
        linked_lot: item.linked_lot || sharedFields.linked_lot || undefined,
        amazon_asin: item.amazon_asin || sharedFields.amazon_asin || undefined,
        notes: item.notes,
      };

      // Create `quantity` copies of the item
      return Array.from({ length: quantity }, () => ({ ...baseItem }));
    });

    try {
      // Use the bulk create API (POST array to /api/inventory)
      const response = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemsToCreate),
      });

      if (!response.ok) {
        throw new Error('Failed to create items');
      }

      // Navigate to inventory list
      router.push('/inventory');
    } catch (error) {
      console.error('Failed to create items:', error);
      setIsCreating(false);
    }
  };

  // Reset to input mode
  const handleReset = () => {
    setShowPreview(false);
    setParsedItems([]);
    setSharedFields({
      source: '',
      purchase_date: '',
      condition: '',
      status: 'NOT YET RECEIVED',
      storage_location: '',
      listing_platform: '',
      listing_date: '',
      listing_value: '',
      sku: '',
      linked_lot: '',
      amazon_asin: '',
    });
  };

  // Input mode
  if (!showPreview) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Natural Language Input
            </CardTitle>
            <CardDescription>
              Describe your inventory items in plain English. AI will extract the details.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder={`Examples:
- "3x 75192 Millennium Falcon from eBay for £120 each, new sealed"
- "Bought 10294, 42100, and 75313 from car boot for £50 total, used condition"
- "New sealed 75192, 10294 from LEGO Store at £200 each"`}
              className="min-h-[200px] font-mono text-sm"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />

            {parseInventory.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Failed to parse input. Please try again or rephrase your description.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleParse}
                disabled={!inputText.trim() || parseInventory.isPending}
              >
                {parseInventory.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Parsing...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Parse with AI
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Preview mode
  return (
    <div className="space-y-6">
      {/* Shared Fields Card */}
      <Card>
        <CardHeader>
          <CardTitle>Shared Fields</CardTitle>
          <CardDescription>
            These values will be applied to all items below
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Row 1: Purchase info */}
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Source</label>
              <Input
                placeholder="e.g., eBay, Car Boot"
                value={sharedFields.source}
                onChange={(e) =>
                  setSharedFields((s) => ({ ...s, source: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Purchase Date</label>
              <Input
                type="date"
                value={sharedFields.purchase_date}
                onChange={(e) =>
                  setSharedFields((s) => ({ ...s, purchase_date: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Condition</label>
              <Select
                value={sharedFields.condition || '_none'}
                onValueChange={(value: string) =>
                  setSharedFields((s) => ({
                    ...s,
                    condition: (value === '_none' ? '' : value) as 'New' | 'Used' | '',
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select condition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Not specified</SelectItem>
                  {CONDITION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select
                value={sharedFields.status}
                onValueChange={(value: string) =>
                  setSharedFields((s) => ({ ...s, status: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* Row 2: Listing info */}
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Listing Platform</label>
              <Input
                placeholder="e.g., eBay, Amazon"
                value={sharedFields.listing_platform}
                onChange={(e) =>
                  setSharedFields((s) => ({ ...s, listing_platform: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Listing Date</label>
              <Input
                type="date"
                value={sharedFields.listing_date}
                onChange={(e) =>
                  setSharedFields((s) => ({ ...s, listing_date: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Listing Value (£)</label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={sharedFields.listing_value}
                onChange={(e) =>
                  setSharedFields((s) => ({ ...s, listing_value: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Storage Location</label>
              <Input
                placeholder="e.g., Shelf A3"
                value={sharedFields.storage_location}
                onChange={(e) =>
                  setSharedFields((s) => ({ ...s, storage_location: e.target.value }))
                }
              />
            </div>
          </div>
          {/* Row 3: Other fields */}
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">SKU</label>
              <Input
                placeholder="SKU reference"
                value={sharedFields.sku}
                onChange={(e) =>
                  setSharedFields((s) => ({ ...s, sku: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Linked Lot</label>
              <Input
                placeholder="Lot reference"
                value={sharedFields.linked_lot}
                onChange={(e) =>
                  setSharedFields((s) => ({ ...s, linked_lot: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Amazon ASIN</label>
              <Input
                placeholder="e.g., B08XYZ1234"
                value={sharedFields.amazon_asin}
                onChange={(e) =>
                  setSharedFields((s) => ({ ...s, amazon_asin: e.target.value }))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Items Preview Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Parsed Items</CardTitle>
              <CardDescription>
                {parsedItems.length} unique item{parsedItems.length !== 1 ? 's' : ''}
                {totalItems !== parsedItems.length && ` (${totalItems} total with quantities)`}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={addItem}>
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="w-full">
            <div className="min-w-[1500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Set #</TableHead>
                    <TableHead className="w-[150px]">Name</TableHead>
                    <TableHead className="w-[60px]">Qty</TableHead>
                    <TableHead className="w-[90px]">Cost (£)</TableHead>
                    <TableHead className="w-[100px]">Condition</TableHead>
                    <TableHead className="w-[100px]">Storage</TableHead>
                    <TableHead className="w-[100px]">Platform</TableHead>
                    <TableHead className="w-[110px]">Listing Date</TableHead>
                    <TableHead className="w-[90px]">List Value</TableHead>
                    <TableHead className="w-[80px]">SKU</TableHead>
                    <TableHead className="w-[100px]">Linked Lot</TableHead>
                    <TableHead className="w-[100px]">ASIN</TableHead>
                    <TableHead className="w-[150px]">Notes</TableHead>
                    <TableHead className="w-[70px]">Confidence</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={15} className="text-center text-muted-foreground">
                        No items parsed. Add items manually or go back and try again.
                      </TableCell>
                    </TableRow>
                  ) : (
                    parsedItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Input
                            value={item.set_number}
                            onChange={(e) =>
                              updateItem(item.id, 'set_number', e.target.value)
                            }
                            placeholder="75192"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.item_name || ''}
                            onChange={(e) =>
                              updateItem(item.id, 'item_name', e.target.value)
                            }
                            placeholder="Item name"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity || 1}
                            onChange={(e) =>
                              updateItem(item.id, 'quantity', parseInt(e.target.value) || 1)
                            }
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={item.cost || ''}
                            onChange={(e) =>
                              updateItem(
                                item.id,
                                'cost',
                                e.target.value ? parseFloat(e.target.value) : 0
                              )
                            }
                            placeholder="0.00"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={item.condition || '_none'}
                            onValueChange={(value: string) =>
                              updateItem(item.id, 'condition', value === '_none' ? '' : value)
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="-" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_none">-</SelectItem>
                              {CONDITION_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.storage_location || ''}
                            onChange={(e) =>
                              updateItem(item.id, 'storage_location', e.target.value)
                            }
                            placeholder="Location"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.listing_platform || ''}
                            onChange={(e) =>
                              updateItem(item.id, 'listing_platform', e.target.value)
                            }
                            placeholder="Platform"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="date"
                            value={item.listing_date || ''}
                            onChange={(e) =>
                              updateItem(item.id, 'listing_date', e.target.value)
                            }
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={item.listing_value || ''}
                            onChange={(e) =>
                              updateItem(
                                item.id,
                                'listing_value',
                                e.target.value ? parseFloat(e.target.value) : 0
                              )
                            }
                            placeholder="0.00"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.sku || ''}
                            onChange={(e) =>
                              updateItem(item.id, 'sku', e.target.value)
                            }
                            placeholder="SKU"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.linked_lot || ''}
                            onChange={(e) =>
                              updateItem(item.id, 'linked_lot', e.target.value)
                            }
                            placeholder="Lot ref"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.amazon_asin || ''}
                            onChange={(e) =>
                              updateItem(item.id, 'amazon_asin', e.target.value)
                            }
                            placeholder="ASIN"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.notes || ''}
                            onChange={(e) =>
                              updateItem(item.id, 'notes', e.target.value)
                            }
                            placeholder="Notes"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              item.confidence >= 0.8
                                ? 'default'
                                : item.confidence >= 0.5
                                  ? 'secondary'
                                  : 'destructive'
                            }
                          >
                            {Math.round(item.confidence * 100)}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => removeItem(item.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={handleReset}>
          Back to Input
        </Button>
        <Button
          onClick={handleCreate}
          disabled={parsedItems.length === 0 || parsedItems.some((i) => !i.set_number) || isCreating}
        >
          {isCreating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Check className="mr-2 h-4 w-4" />
              Create {totalItems} Item{totalItems !== 1 ? 's' : ''}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
