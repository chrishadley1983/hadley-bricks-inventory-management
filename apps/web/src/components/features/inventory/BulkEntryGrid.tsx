'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Grid3X3, Plus, Trash2, Check, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

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

interface BulkRow {
  id: string;
  set_number: string;
  item_name: string;
  condition: 'New' | 'Used' | '';
  status: string;
  cost: string;
  source: string;
  purchase_date: string;
  storage_location: string;
  listing_platform: string;
  listing_date: string;
  listing_value: string;
  sku: string;
  linked_lot: string;
  amazon_asin: string;
  notes: string;
}

interface RowErrors {
  set_number?: string;
  cost?: string;
  listing_value?: string;
}

function createEmptyRow(): BulkRow {
  return {
    id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    set_number: '',
    item_name: '',
    condition: '',
    status: 'NOT YET RECEIVED',
    cost: '',
    source: '',
    purchase_date: '',
    storage_location: '',
    listing_platform: '',
    listing_date: '',
    listing_value: '',
    sku: '',
    linked_lot: '',
    amazon_asin: '',
    notes: '',
  };
}

function validateRow(row: BulkRow): RowErrors {
  const errors: RowErrors = {};

  if (!row.set_number.trim()) {
    errors.set_number = 'Required';
  }

  if (row.cost && isNaN(parseFloat(row.cost))) {
    errors.cost = 'Invalid number';
  }

  if (row.listing_value && isNaN(parseFloat(row.listing_value))) {
    errors.listing_value = 'Invalid number';
  }

  return errors;
}

/**
 * Bulk Entry Grid component for spreadsheet-like inventory entry
 */
export function BulkEntryGrid() {
  const router = useRouter();

  // State
  const [rows, setRows] = React.useState<BulkRow[]>([createEmptyRow(), createEmptyRow(), createEmptyRow()]);
  const [errors, setErrors] = React.useState<Map<string, RowErrors>>(new Map());
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState('');

  // Update a single cell
  const updateCell = (rowId: string, field: keyof BulkRow, value: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, [field]: value } : row
      )
    );

    // Clear error for this field
    setErrors((prev) => {
      const rowErrors = prev.get(rowId);
      if (rowErrors) {
        const newErrors = { ...rowErrors };
        delete newErrors[field as keyof RowErrors];
        if (Object.keys(newErrors).length === 0) {
          prev.delete(rowId);
        } else {
          prev.set(rowId, newErrors);
        }
      }
      return new Map(prev);
    });
  };

  // Add a new row
  const addRow = () => {
    setRows((prev) => [...prev, createEmptyRow()]);
  };

  // Remove a row
  const removeRow = (rowId: string) => {
    if (rows.length <= 1) return; // Keep at least one row
    setRows((prev) => prev.filter((row) => row.id !== rowId));
    setErrors((prev) => {
      prev.delete(rowId);
      return new Map(prev);
    });
  };

  // Get non-empty rows
  const getNonEmptyRows = () => {
    return rows.filter((row) => row.set_number.trim());
  };

  // Validate all rows
  const validateAllRows = (): boolean => {
    const newErrors = new Map<string, RowErrors>();
    const nonEmptyRows = getNonEmptyRows();

    let hasErrors = false;
    nonEmptyRows.forEach((row) => {
      const rowErrors = validateRow(row);
      if (Object.keys(rowErrors).length > 0) {
        newErrors.set(row.id, rowErrors);
        hasErrors = true;
      }
    });

    setErrors(newErrors);
    return !hasErrors;
  };

  // Submit all rows
  const handleSubmit = async () => {
    const nonEmptyRows = getNonEmptyRows();

    if (nonEmptyRows.length === 0) {
      setSubmitError('Please enter at least one item');
      return;
    }

    if (!validateAllRows()) {
      setSubmitError('Please fix the errors before submitting');
      return;
    }

    setSubmitError('');
    setIsSubmitting(true);

    // Prepare items for API
    const items = nonEmptyRows.map((row) => ({
      set_number: row.set_number.trim(),
      item_name: row.item_name.trim() || undefined,
      condition: row.condition || undefined,
      status: row.status || 'NOT YET RECEIVED',
      cost: row.cost ? parseFloat(row.cost) : undefined,
      source: row.source.trim() || undefined,
      purchase_date: row.purchase_date || undefined,
      storage_location: row.storage_location.trim() || undefined,
      listing_platform: row.listing_platform.trim() || undefined,
      listing_date: row.listing_date || undefined,
      listing_value: row.listing_value ? parseFloat(row.listing_value) : undefined,
      sku: row.sku.trim() || undefined,
      linked_lot: row.linked_lot.trim() || undefined,
      amazon_asin: row.amazon_asin.trim() || undefined,
      notes: row.notes.trim() || undefined,
    }));

    try {
      const response = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
      });

      if (!response.ok) {
        throw new Error('Failed to create items');
      }

      router.push('/inventory');
    } catch (error) {
      console.error('Submit failed:', error);
      setSubmitError('Failed to create items. Please try again.');
      setIsSubmitting(false);
    }
  };

  // Handle paste event for TSV/CSV data
  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;

    // Parse TSV/CSV
    const lines = text.split('\n').filter((line) => line.trim());
    if (lines.length === 0) return;

    // Try to detect if it's TSV or CSV
    const delimiter = lines[0].includes('\t') ? '\t' : ',';

    const newRows: BulkRow[] = [];
    lines.forEach((line) => {
      const values = line.split(delimiter).map((v) => v.trim().replace(/^"|"$/g, ''));
      if (values[0]) {
        newRows.push({
          id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          set_number: values[0] || '',
          item_name: values[1] || '',
          condition: (values[2] === 'New' || values[2] === 'Used' ? values[2] : '') as '' | 'New' | 'Used',
          status: values[3] || 'NOT YET RECEIVED',
          cost: values[4] || '',
          source: values[5] || '',
          purchase_date: values[6] || '',
          storage_location: values[7] || '',
          listing_platform: values[8] || '',
          listing_date: values[9] || '',
          listing_value: values[10] || '',
          sku: values[11] || '',
          linked_lot: values[12] || '',
          amazon_asin: values[13] || '',
          notes: values[14] || '',
        });
      }
    });

    if (newRows.length > 0) {
      e.preventDefault();
      // Replace empty rows or add to existing
      setRows((prev) => {
        const nonEmpty = prev.filter((r) => r.set_number.trim());
        return [...nonEmpty, ...newRows];
      });
    }
  };

  const validRowCount = getNonEmptyRows().length;
  const hasErrors = errors.size > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Grid3X3 className="h-5 w-5" />
                Bulk Entry Grid
              </CardTitle>
              <CardDescription>
                Enter multiple items in a spreadsheet-like grid. Paste from Excel or Google Sheets.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus className="mr-2 h-4 w-4" />
              Add Row
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="w-full" onPaste={handlePaste}>
            <div className="min-w-[1700px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Set # *</TableHead>
                    <TableHead className="w-[140px]">Name</TableHead>
                    <TableHead className="w-[90px]">Condition</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead className="w-[80px]">Cost (£)</TableHead>
                    <TableHead className="w-[100px]">Source</TableHead>
                    <TableHead className="w-[110px]">Purchase Date</TableHead>
                    <TableHead className="w-[90px]">Storage</TableHead>
                    <TableHead className="w-[90px]">Platform</TableHead>
                    <TableHead className="w-[110px]">Listing Date</TableHead>
                    <TableHead className="w-[80px]">List Value</TableHead>
                    <TableHead className="w-[80px]">SKU</TableHead>
                    <TableHead className="w-[90px]">Linked Lot</TableHead>
                    <TableHead className="w-[100px]">ASIN</TableHead>
                    <TableHead className="w-[130px]">Notes</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const rowErrors = errors.get(row.id) || {};
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Input
                            value={row.set_number}
                            onChange={(e) => updateCell(row.id, 'set_number', e.target.value)}
                            placeholder="75192"
                            className={`h-8 ${rowErrors.set_number ? 'border-destructive' : ''}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.item_name}
                            onChange={(e) => updateCell(row.id, 'item_name', e.target.value)}
                            placeholder="Item name"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={row.condition || '_none'}
                            onValueChange={(value: string) => updateCell(row.id, 'condition', value === '_none' ? '' : value)}
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
                          <Select
                            value={row.status}
                            onValueChange={(value: string) => updateCell(row.id, 'status', value)}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={row.cost}
                            onChange={(e) => updateCell(row.id, 'cost', e.target.value)}
                            placeholder="0.00"
                            className={`h-8 ${rowErrors.cost ? 'border-destructive' : ''}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.source}
                            onChange={(e) => updateCell(row.id, 'source', e.target.value)}
                            placeholder="Source"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="date"
                            value={row.purchase_date}
                            onChange={(e) => updateCell(row.id, 'purchase_date', e.target.value)}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.storage_location}
                            onChange={(e) => updateCell(row.id, 'storage_location', e.target.value)}
                            placeholder="Location"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.listing_platform}
                            onChange={(e) => updateCell(row.id, 'listing_platform', e.target.value)}
                            placeholder="Platform"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="date"
                            value={row.listing_date}
                            onChange={(e) => updateCell(row.id, 'listing_date', e.target.value)}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={row.listing_value}
                            onChange={(e) => updateCell(row.id, 'listing_value', e.target.value)}
                            placeholder="0.00"
                            className={`h-8 ${rowErrors.listing_value ? 'border-destructive' : ''}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.sku}
                            onChange={(e) => updateCell(row.id, 'sku', e.target.value)}
                            placeholder="SKU"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.linked_lot}
                            onChange={(e) => updateCell(row.id, 'linked_lot', e.target.value)}
                            placeholder="Lot ref"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.amazon_asin}
                            onChange={(e) => updateCell(row.id, 'amazon_asin', e.target.value)}
                            placeholder="ASIN"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.notes}
                            onChange={(e) => updateCell(row.id, 'notes', e.target.value)}
                            placeholder="Notes"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => removeRow(row.id)}
                            disabled={rows.length <= 1}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          <p className="text-xs text-muted-foreground mt-4">
            Tip: Copy data from Excel or Google Sheets and paste directly into this grid.
            Column order: Set #, Name, Condition, Status, Cost, Source, Purchase Date, Storage, Platform, Listing Date, List Value, SKU, Linked Lot, ASIN, Notes
          </p>
        </CardContent>
      </Card>

      {/* Errors */}
      {(submitError || hasErrors) && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {submitError || 'Please fix the validation errors in the highlighted fields'}
          </AlertDescription>
        </Alert>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-4">
        <Button
          onClick={handleSubmit}
          disabled={validRowCount === 0 || isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Check className="mr-2 h-4 w-4" />
              Create {validRowCount} Item{validRowCount !== 1 ? 's' : ''}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
