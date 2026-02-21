'use client';

import * as React from 'react';
import {
  FileSpreadsheet,
  Upload,
  ClipboardPaste,
  Download,
  AlertCircle,
  Camera,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  parseAndConsolidate,
  type EvaluationInputItem,
  type ParseError,
} from '@/lib/purchase-evaluator';

interface InputStepProps {
  onItemsParsed: (items: EvaluationInputItem[], source: 'csv_upload' | 'clipboard_paste') => void;
  onSwitchToPhotoMode?: () => void;
}

/**
 * Input step for the purchase evaluator wizard
 * Allows CSV file upload, clipboard paste, or photo analysis
 */
export function InputStep({ onItemsParsed, onSwitchToPhotoMode }: InputStepProps) {
  const [pasteContent, setPasteContent] = React.useState('');
  const [parseErrors, setParseErrors] = React.useState<ParseError[]>([]);
  const [isDragging, setIsDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Handle file selection
  const handleFile = async (file: File | null) => {
    if (!file) return;

    if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
      setParseErrors([{ row: 0, message: 'Please upload a CSV or TXT file' }]);
      return;
    }

    try {
      const content = await file.text();
      const result = parseAndConsolidate(content);

      if (result.errors.length > 0) {
        setParseErrors(result.errors);
      }

      if (result.items.length > 0) {
        onItemsParsed(result.items, 'csv_upload');
      } else if (result.errors.length === 0) {
        setParseErrors([{ row: 0, message: 'No valid items found in file' }]);
      }
    } catch (error) {
      console.error('Failed to parse file:', error);
      setParseErrors([{ row: 0, message: 'Failed to read file' }]);
    }
  };

  // Handle paste button click
  const handlePaste = () => {
    if (!pasteContent.trim()) {
      setParseErrors([{ row: 0, message: 'Please paste some content first' }]);
      return;
    }

    const result = parseAndConsolidate(pasteContent);

    if (result.errors.length > 0) {
      setParseErrors(result.errors);
    }

    if (result.items.length > 0) {
      onItemsParsed(result.items, 'clipboard_paste');
    } else if (result.errors.length === 0) {
      setParseErrors([{ row: 0, message: 'No valid items found in pasted content' }]);
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
    window.location.href = '/api/purchase-evaluator/template';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Import Purchase Data
        </CardTitle>
        <CardDescription>
          Upload a CSV file or paste data from a spreadsheet to evaluate a potential purchase
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs defaultValue="upload" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Upload File
            </TabsTrigger>
            <TabsTrigger value="paste" className="flex items-center gap-2">
              <ClipboardPaste className="h-4 w-4" />
              Paste Data
            </TabsTrigger>
            <TabsTrigger value="photo" className="flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Photo Analysis
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-4">
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
                accept=".csv,.txt"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] || null)}
              />
              <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {isDragging ? 'Drop file here' : 'Drag & drop a CSV file or click to browse'}
              </p>
            </div>
          </TabsContent>

          <TabsContent value="paste" className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Paste data from Excel or Google Sheets. Include headers in the first row.
              </p>
              <Textarea
                placeholder="Item Code&#9;Item Name&#9;Condition&#9;Quantity&#9;Cost
75192&#9;Millennium Falcon&#9;New&#9;1&#9;50.00
40585&#9;World Map&#9;New&#9;2&#9;15.00"
                className="min-h-[200px] font-mono text-sm"
                value={pasteContent}
                onChange={(e) => {
                  setPasteContent(e.target.value);
                  setParseErrors([]);
                }}
              />
              <div className="flex justify-end">
                <Button onClick={handlePaste}>Parse Data</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="photo" className="space-y-4">
            {/* Photo Analysis Feature Card */}
            <div className="rounded-lg border bg-gradient-to-br from-primary/5 to-primary/10 p-6">
              <div className="flex items-start gap-4">
                <div className="rounded-full bg-primary/10 p-3">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 space-y-2">
                  <h3 className="text-lg font-semibold">AI-Powered Photo Analysis</h3>
                  <p className="text-sm text-muted-foreground">
                    Upload photos of LEGO lots from auctions, marketplace listings, or collection
                    shots. Our AI will identify sets, minifigures, and parts, then assess their
                    condition.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">What it identifies:</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      LEGO sets (from box photos or numbers)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      Minifigures (character identification)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      Loose parts and bulk lots
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      Non-LEGO items (flagged separately)
                    </li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Condition assessment:</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      Box condition (Mint to Poor)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      Seal status (Factory Sealed, Open, etc.)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      Damage notes and concerns
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      Confidence scores per item
                    </li>
                  </ul>
                </div>
              </div>

              <div className="mt-6 p-4 bg-background/50 rounded-lg">
                <h4 className="font-medium text-sm mb-2">Calculate Maximum Purchase Price</h4>
                <p className="text-sm text-muted-foreground">
                  Set your target profit margin (20-50%) and we&apos;ll calculate the maximum you
                  should pay for the lot based on current market prices.
                </p>
              </div>

              {onSwitchToPhotoMode && (
                <div className="mt-6 flex justify-center">
                  <Button size="lg" onClick={onSwitchToPhotoMode} className="gap-2">
                    <Camera className="h-4 w-4" />
                    Start Photo Analysis
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Errors */}
        {parseErrors.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <ul className="list-disc list-inside space-y-1">
                {parseErrors.slice(0, 5).map((error, i) => (
                  <li key={i}>
                    {error.row > 0 ? `Row ${error.row}: ` : ''}
                    {error.message}
                  </li>
                ))}
                {parseErrors.length > 5 && <li>...and {parseErrors.length - 5} more errors</li>}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Column guide */}
        <div className="text-sm space-y-2">
          <p className="font-medium">Required Columns:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>
              <strong>Item Code / Set Number</strong> - LEGO set number (e.g., 75192)
            </li>
            <li>
              <strong>Condition</strong> - New or Used
            </li>
          </ul>
          <p className="font-medium mt-4">Optional Columns:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>
              <strong>Item Name</strong> - Set name/description
            </li>
            <li>
              <strong>Quantity</strong> - Number of units (duplicates auto-detected if not provided)
            </li>
            <li>
              <strong>Cost</strong> - Unit cost (can also enter total purchase price later)
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
