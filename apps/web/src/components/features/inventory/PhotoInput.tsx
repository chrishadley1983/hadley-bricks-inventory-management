'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Loader2, Plus, Trash2, Check, AlertCircle, X, Upload } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useExtractSetNumbers } from '@/hooks/use-extract-set-numbers';

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

interface UploadedImage {
  id: string;
  file: File;
  preview: string;
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

interface ExtractedItem {
  id: string;
  set_number: string;
  item_name: string;
  confidence: number;
  cost: string;
  condition: 'New' | 'Used' | '';
  storage_location: string;
  listing_platform: string;
  listing_date: string;
  listing_value: string;
  sku: string;
  linked_lot: string;
  amazon_asin: string;
  notes: string;
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
 * Photo Input component for extracting set numbers from images
 */
export function PhotoInput() {
  const router = useRouter();
  const extractSetNumbers = useExtractSetNumbers();

  // Upload state
  const [uploadedImages, setUploadedImages] = React.useState<UploadedImage[]>([]);
  const [isDragging, setIsDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Preview state
  const [extractedItems, setExtractedItems] = React.useState<ExtractedItem[]>([]);
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
  const [isCreating, setIsCreating] = React.useState(false);

  // Clean up object URLs when component unmounts or images change
  React.useEffect(() => {
    return () => {
      uploadedImages.forEach((img) => URL.revokeObjectURL(img.preview));
    };
  }, [uploadedImages]);

  // Convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data:image/xxx;base64, prefix
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Get media type from file
  const getMediaType = (file: File): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' => {
    const type = file.type;
    if (type === 'image/jpeg' || type === 'image/jpg') return 'image/jpeg';
    if (type === 'image/png') return 'image/png';
    if (type === 'image/gif') return 'image/gif';
    if (type === 'image/webp') return 'image/webp';
    return 'image/jpeg'; // Default fallback
  };

  // Handle file selection
  const handleFiles = async (files: FileList | null) => {
    if (!files) return;

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const newImages: UploadedImage[] = [];

    for (const file of Array.from(files)) {
      if (!validTypes.includes(file.type)) continue;
      if (uploadedImages.length + newImages.length >= 10) break; // Max 10 images

      const base64 = await fileToBase64(file);
      const preview = URL.createObjectURL(file);

      newImages.push({
        id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        preview,
        base64,
        mediaType: getMediaType(file),
      });
    }

    setUploadedImages((prev) => [...prev, ...newImages]);
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
    handleFiles(e.dataTransfer.files);
  };

  // Remove an image
  const removeImage = (id: string) => {
    setUploadedImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.preview);
      return prev.filter((i) => i.id !== id);
    });
  };

  // Extract set numbers from images
  const handleExtract = async () => {
    if (uploadedImages.length === 0) return;

    try {
      const result = await extractSetNumbers.mutateAsync({
        images: uploadedImages.map((img) => ({
          base64: img.base64,
          mediaType: img.mediaType,
        })),
      });

      // Convert extractions to editable items
      const items: ExtractedItem[] = result.extractions.map((ext, index) => ({
        id: `item-${index}-${Date.now()}`,
        set_number: ext.set_number,
        item_name: '',
        confidence: ext.confidence,
        cost: '',
        condition: '' as const,
        storage_location: '',
        listing_platform: '',
        listing_date: '',
        listing_value: '',
        sku: '',
        linked_lot: '',
        amazon_asin: '',
        notes: '',
      }));

      setExtractedItems(items);
      setShowPreview(true);
    } catch (error) {
      console.error('Failed to extract set numbers:', error);
    }
  };

  // Update a single item field
  const updateItem = (id: string, field: keyof ExtractedItem, value: string | number) => {
    setExtractedItems((items) =>
      items.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  // Remove an item from the list
  const removeItem = (id: string) => {
    setExtractedItems((items) => items.filter((item) => item.id !== id));
  };

  // Add a new empty item
  const addItem = () => {
    const newItem: ExtractedItem = {
      id: `item-new-${Date.now()}`,
      set_number: '',
      item_name: '',
      confidence: 1,
      cost: '',
      condition: '',
      storage_location: '',
      listing_platform: '',
      listing_date: '',
      listing_value: '',
      sku: '',
      linked_lot: '',
      amazon_asin: '',
      notes: '',
    };
    setExtractedItems((items) => [...items, newItem]);
  };

  // Create all items
  const handleCreate = async () => {
    if (extractedItems.length === 0) return;

    setIsCreating(true);

    // Prepare items for creation
    const listingValue = sharedFields.listing_value
      ? parseFloat(sharedFields.listing_value)
      : undefined;
    const itemsToCreate = extractedItems.map((item) => ({
      set_number: item.set_number,
      item_name: item.item_name || undefined,
      condition: item.condition || sharedFields.condition || undefined,
      status: sharedFields.status || 'NOT YET RECEIVED',
      cost: item.cost ? parseFloat(item.cost) : undefined,
      source: sharedFields.source || undefined,
      purchase_date: sharedFields.purchase_date || undefined,
      storage_location: item.storage_location || sharedFields.storage_location || undefined,
      listing_platform: item.listing_platform || sharedFields.listing_platform || undefined,
      listing_date: item.listing_date || sharedFields.listing_date || undefined,
      listing_value: item.listing_value ? parseFloat(item.listing_value) : listingValue,
      sku: item.sku || sharedFields.sku || undefined,
      linked_lot: item.linked_lot || sharedFields.linked_lot || undefined,
      amazon_asin: item.amazon_asin || sharedFields.amazon_asin || undefined,
      notes: item.notes || undefined,
    }));

    try {
      const response = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemsToCreate),
      });

      if (!response.ok) {
        throw new Error('Failed to create items');
      }

      router.push('/inventory');
    } catch (error) {
      console.error('Failed to create items:', error);
      setIsCreating(false);
    }
  };

  // Reset to upload mode
  const handleReset = () => {
    setShowPreview(false);
    setExtractedItems([]);
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

  // Upload mode
  if (!showPreview) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Photo Input
            </CardTitle>
            <CardDescription>
              Upload photos of LEGO boxes to extract set numbers using AI vision
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Drop zone */}
            <div
              className={`
                relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
                ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
                ${uploadedImages.length >= 10 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary/50'}
              `}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => uploadedImages.length < 10 && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
                disabled={uploadedImages.length >= 10}
              />
              <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {isDragging
                  ? 'Drop images here'
                  : uploadedImages.length >= 10
                    ? 'Maximum 10 images reached'
                    : 'Drag & drop images or click to browse'}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Supports JPEG, PNG, GIF, WebP (max 10 images)
              </p>
            </div>

            {/* Image previews */}
            {uploadedImages.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {uploadedImages.length} image{uploadedImages.length !== 1 ? 's' : ''} selected
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      uploadedImages.forEach((img) => URL.revokeObjectURL(img.preview));
                      setUploadedImages([]);
                    }}
                  >
                    Clear all
                  </Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  {uploadedImages.map((img) => (
                    <div key={img.id} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.preview}
                        alt="Uploaded"
                        className="w-full h-24 object-cover rounded-md"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeImage(img.id);
                        }}
                        className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {extractSetNumbers.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Failed to extract set numbers. Please try again or use different images.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleExtract}
                disabled={uploadedImages.length === 0 || extractSetNumbers.isPending}
              >
                {extractSetNumbers.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Extracting...
                  </>
                ) : (
                  <>
                    <Camera className="mr-2 h-4 w-4" />
                    Extract Set Numbers
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
          <CardDescription>These values will be applied to all items below</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Row 1: Purchase info */}
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Source</label>
              <Input
                placeholder="e.g., eBay, Car Boot"
                value={sharedFields.source}
                onChange={(e) => setSharedFields((s) => ({ ...s, source: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Purchase Date</label>
              <Input
                type="date"
                value={sharedFields.purchase_date}
                onChange={(e) => setSharedFields((s) => ({ ...s, purchase_date: e.target.value }))}
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
                onValueChange={(value: string) => setSharedFields((s) => ({ ...s, status: value }))}
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
                onChange={(e) => setSharedFields((s) => ({ ...s, listing_date: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Listing Value (£)</label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={sharedFields.listing_value}
                onChange={(e) => setSharedFields((s) => ({ ...s, listing_value: e.target.value }))}
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
                onChange={(e) => setSharedFields((s) => ({ ...s, sku: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Linked Lot</label>
              <Input
                placeholder="Lot reference"
                value={sharedFields.linked_lot}
                onChange={(e) => setSharedFields((s) => ({ ...s, linked_lot: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Amazon ASIN</label>
              <Input
                placeholder="e.g., B08XYZ1234"
                value={sharedFields.amazon_asin}
                onChange={(e) => setSharedFields((s) => ({ ...s, amazon_asin: e.target.value }))}
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
              <CardTitle>Extracted Items</CardTitle>
              <CardDescription>
                {extractedItems.length} set number{extractedItems.length !== 1 ? 's' : ''} found
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
                  {extractedItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={14} className="text-center text-muted-foreground">
                        No set numbers found. Add items manually or try different images.
                      </TableCell>
                    </TableRow>
                  ) : (
                    extractedItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Input
                            value={item.set_number}
                            onChange={(e) => updateItem(item.id, 'set_number', e.target.value)}
                            placeholder="75192"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.item_name}
                            onChange={(e) => updateItem(item.id, 'item_name', e.target.value)}
                            placeholder="Item name"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={item.cost}
                            onChange={(e) => updateItem(item.id, 'cost', e.target.value)}
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
                            value={item.storage_location}
                            onChange={(e) =>
                              updateItem(item.id, 'storage_location', e.target.value)
                            }
                            placeholder="Location"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.listing_platform}
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
                            value={item.listing_date}
                            onChange={(e) => updateItem(item.id, 'listing_date', e.target.value)}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={item.listing_value}
                            onChange={(e) => updateItem(item.id, 'listing_value', e.target.value)}
                            placeholder="0.00"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.sku}
                            onChange={(e) => updateItem(item.id, 'sku', e.target.value)}
                            placeholder="SKU"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.linked_lot}
                            onChange={(e) => updateItem(item.id, 'linked_lot', e.target.value)}
                            placeholder="Lot ref"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.amazon_asin}
                            onChange={(e) => updateItem(item.id, 'amazon_asin', e.target.value)}
                            placeholder="ASIN"
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.notes}
                            onChange={(e) => updateItem(item.id, 'notes', e.target.value)}
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
          Back to Upload
        </Button>
        <Button
          onClick={handleCreate}
          disabled={
            extractedItems.length === 0 || extractedItems.some((i) => !i.set_number) || isCreating
          }
        >
          {isCreating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Check className="mr-2 h-4 w-4" />
              Create {extractedItems.length} Item{extractedItems.length !== 1 ? 's' : ''}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
