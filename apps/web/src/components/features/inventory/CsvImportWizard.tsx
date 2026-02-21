'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  FileSpreadsheet,
  Loader2,
  Download,
  Upload,
  Check,
  AlertCircle,
  X,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useInventoryImport, parseCsvContent } from '@/hooks/use-inventory-import';

interface ParsedItem {
  set_number: string;
  item_name?: string;
  condition?: 'New' | 'Used';
  status?: string;
  cost?: number;
  source?: string;
  purchase_date?: string;
  storage_location?: string;
  listing_platform?: string;
  listing_date?: string;
  listing_value?: number;
  sku?: string;
  linked_lot?: string;
  amazon_asin?: string;
  notes?: string;
}

interface ParseError {
  row: number;
  message: string;
}

type WizardStep = 'upload' | 'preview' | 'importing' | 'complete';

/**
 * CSV Import Wizard component for bulk inventory import
 */
export function CsvImportWizard() {
  const router = useRouter();
  const importMutation = useInventoryImport();

  // State
  const [step, setStep] = React.useState<WizardStep>('upload');
  const [fileName, setFileName] = React.useState('');
  const [parsedItems, setParsedItems] = React.useState<ParsedItem[]>([]);
  const [parseErrors, setParseErrors] = React.useState<ParseError[]>([]);
  const [isDragging, setIsDragging] = React.useState(false);
  const [importedCount, setImportedCount] = React.useState(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Handle file selection
  const handleFile = async (file: File | null) => {
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      setParseErrors([{ row: 0, message: 'Please upload a CSV file' }]);
      return;
    }

    setFileName(file.name);

    try {
      const content = await file.text();
      const { items, errors } = parseCsvContent(content);

      setParsedItems(items);
      setParseErrors(errors);

      if (items.length > 0 || errors.length > 0) {
        setStep('preview');
      }
    } catch (error) {
      console.error('Failed to parse CSV:', error);
      setParseErrors([{ row: 0, message: 'Failed to read CSV file' }]);
    }
  };

  // Handle drag events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  // Download template
  const handleDownloadTemplate = () => {
    window.location.href = '/api/inventory/template';
  };

  // Import items
  const handleImport = async () => {
    if (parsedItems.length === 0) return;

    setStep('importing');

    try {
      const result = await importMutation.mutateAsync(parsedItems);
      setImportedCount(result.data.length);
      setStep('complete');
    } catch (error) {
      console.error('Import failed:', error);
      setStep('preview');
    }
  };

  // Reset wizard
  const handleReset = () => {
    setStep('upload');
    setFileName('');
    setParsedItems([]);
    setParseErrors([]);
    setImportedCount(0);
  };

  // Upload step
  if (step === 'upload') {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              CSV Import
            </CardTitle>
            <CardDescription>Import multiple inventory items from a CSV file</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Template download */}
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div>
                <p className="font-medium">Download Template</p>
                <p className="text-sm text-muted-foreground">
                  Get a CSV template with the correct column headers
                </p>
              </div>
              <Button variant="outline" onClick={handleDownloadTemplate}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>

            {/* Drop zone */}
            <div
              className={`
                relative border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
                ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
              `}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] || null)}
              />
              <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {isDragging ? 'Drop CSV file here' : 'Drag & drop a CSV file or click to browse'}
              </p>
            </div>

            {parseErrors.length > 0 && step === 'upload' && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{parseErrors[0].message}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Column guide */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Supported Columns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-sm">
              <div>
                <span className="font-medium">set_number</span>
                <span className="text-destructive">*</span>
              </div>
              <div>item_name</div>
              <div>condition</div>
              <div>status</div>
              <div>cost</div>
              <div>source</div>
              <div>purchase_date</div>
              <div>storage_location</div>
              <div>listing_platform</div>
              <div>listing_date</div>
              <div>listing_value</div>
              <div>sku</div>
              <div>linked_lot</div>
              <div>amazon_asin</div>
              <div>notes</div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              <span className="text-destructive">*</span> Required field. Dates should be in
              YYYY-MM-DD format. Condition: &quot;New&quot; or &quot;Used&quot;. Status: &quot;NOT
              YET RECEIVED&quot;, &quot;BACKLOG&quot;, &quot;LISTED&quot;, or &quot;SOLD&quot;.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Preview step
  if (step === 'preview') {
    return (
      <div className="space-y-6">
        {/* Summary */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Import Preview</CardTitle>
                <CardDescription>{fileName}</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={handleReset}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="text-lg font-semibold">{parsedItems.length}</span>
                <span className="text-muted-foreground">valid items</span>
              </div>
              {parseErrors.length > 0 && (
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-destructive" />
                  <span className="text-lg font-semibold">{parseErrors.length}</span>
                  <span className="text-muted-foreground">errors</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Errors */}
        {parseErrors.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Errors ({parseErrors.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[150px]">
                <div className="space-y-2">
                  {parseErrors.map((error, index) => (
                    <div key={index} className="flex items-start gap-2 text-sm">
                      <Badge variant="destructive" className="shrink-0">
                        Row {error.row}
                      </Badge>
                      <span>{error.message}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* Items table */}
        {parsedItems.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Items to Import</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px] w-full">
                <div className="min-w-[1500px] rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[90px]">Set #</TableHead>
                        <TableHead className="w-[140px]">Name</TableHead>
                        <TableHead className="w-[80px]">Condition</TableHead>
                        <TableHead className="w-[110px]">Status</TableHead>
                        <TableHead className="w-[70px]">Cost</TableHead>
                        <TableHead className="w-[90px]">Source</TableHead>
                        <TableHead className="w-[100px]">Purch Date</TableHead>
                        <TableHead className="w-[80px]">Storage</TableHead>
                        <TableHead className="w-[80px]">Platform</TableHead>
                        <TableHead className="w-[100px]">List Date</TableHead>
                        <TableHead className="w-[80px]">List Value</TableHead>
                        <TableHead className="w-[70px]">SKU</TableHead>
                        <TableHead className="w-[80px]">Linked Lot</TableHead>
                        <TableHead className="w-[90px]">ASIN</TableHead>
                        <TableHead className="w-[120px]">Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedItems.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-mono">{item.set_number}</TableCell>
                          <TableCell>{item.item_name || '-'}</TableCell>
                          <TableCell>
                            {item.condition ? (
                              <Badge variant="outline">{item.condition}</Badge>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                          <TableCell>
                            {item.status ? <Badge variant="secondary">{item.status}</Badge> : '-'}
                          </TableCell>
                          <TableCell>
                            {item.cost !== undefined ? `£${item.cost.toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell>{item.source || '-'}</TableCell>
                          <TableCell>{item.purchase_date || '-'}</TableCell>
                          <TableCell>{item.storage_location || '-'}</TableCell>
                          <TableCell>{item.listing_platform || '-'}</TableCell>
                          <TableCell>{item.listing_date || '-'}</TableCell>
                          <TableCell>
                            {item.listing_value !== undefined
                              ? `£${item.listing_value.toFixed(2)}`
                              : '-'}
                          </TableCell>
                          <TableCell>{item.sku || '-'}</TableCell>
                          <TableCell>{item.linked_lot || '-'}</TableCell>
                          <TableCell>{item.amazon_asin || '-'}</TableCell>
                          <TableCell>{item.notes || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* Import error */}
        {importMutation.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Import Failed</AlertTitle>
            <AlertDescription>
              {importMutation.error?.message || 'Failed to import items. Please try again.'}
            </AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        <div className="flex justify-between">
          <Button variant="outline" onClick={handleReset}>
            Back
          </Button>
          <Button
            onClick={handleImport}
            disabled={parsedItems.length === 0 || importMutation.isPending}
          >
            <Check className="mr-2 h-4 w-4" />
            Import {parsedItems.length} Item{parsedItems.length !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    );
  }

  // Importing step
  if (step === 'importing') {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium">Importing items...</p>
            <p className="text-muted-foreground">
              Please wait while we import your inventory items
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Complete step
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col items-center justify-center p-12">
          <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <p className="text-lg font-medium">Import Complete!</p>
          <p className="text-muted-foreground mb-6">
            Successfully imported {importedCount} inventory item{importedCount !== 1 ? 's' : ''}
          </p>
          <div className="flex gap-4">
            <Button variant="outline" onClick={handleReset}>
              Import More
            </Button>
            <Button onClick={() => router.push('/inventory')}>View Inventory</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
