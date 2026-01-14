'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Copy,
  Save,
  Check,
  ChevronDown,
  ChevronUp,
  Code,
  Eye,
  Package,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { useTemplates, useGenerateListing, useCreateListing, useSettings } from '@/hooks/listing-assistant';
import { RichTextEditor, HtmlSourceEditor } from '../shared/RichTextEditor';
import { ImageUpload, type UploadedImage } from '../generator/ImageUpload';
import { EbaySoldItemsDisplay } from '../generator/EbaySoldItemsDisplay';
import { InventoryImportModal } from '../generator/InventoryImportModal';
import { LISTING_TONES, CONDITION_COLORS } from '@/lib/listing-assistant/constants';
import type { ListingTone, ListingCondition, GenerateListingResponse } from '@/lib/listing-assistant/types';
import type { InventoryItem } from '@hadley-bricks/database';

interface GeneratorTabProps {
  inventoryItemId?: string | null;
}

export function GeneratorTab({ inventoryItemId }: GeneratorTabProps) {
  const { toast } = useToast();

  // Fetch templates and settings
  const { data: templates, isLoading: templatesLoading } = useTemplates();
  const { data: settings } = useSettings();
  const generateMutation = useGenerateListing();
  const saveMutation = useCreateListing();

  // Form state
  const [itemName, setItemName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [condition, setCondition] = useState<ListingCondition>('Used');
  const [tone, setTone] = useState<ListingTone>('Minimalist');
  const [keyPoints, setKeyPoints] = useState('');
  const [images, setImages] = useState<UploadedImage[]>([]);

  // Result state
  const [result, setResult] = useState<GenerateListingResponse | null>(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [showHtml, setShowHtml] = useState(false);
  const [copied, setCopied] = useState(false);
  const [soldItemsOpen, setSoldItemsOpen] = useState(false);

  // Import modal state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importedInventoryId, setImportedInventoryId] = useState<string | null>(inventoryItemId || null);

  // Set defaults from settings
  useEffect(() => {
    if (settings) {
      setCondition(settings.default_condition);
      setTone(settings.default_tone);
    }
  }, [settings]);

  // Set default template
  useEffect(() => {
    if (templates && templates.length > 0 && !templateId) {
      // Find the default template matching the condition
      const defaultTemplate = templates.find(
        (t) =>
          (condition === 'Used' && t.type === 'lego_used') ||
          (condition === 'New' && t.type === 'lego_new')
      );
      setTemplateId(defaultTemplate?.id || templates[0].id);
    }
  }, [templates, templateId, condition]);

  // Update result state when generation completes
  useEffect(() => {
    if (result) {
      setEditedTitle(result.title);
      setEditedDescription(result.description);
    }
  }, [result]);

  // Handle importing from inventory
  const handleImportInventoryItem = useCallback(
    (item: InventoryItem) => {
      // Build display name
      const displayName = item.item_name
        ? `${item.set_number} - ${item.item_name}`
        : item.set_number;
      setItemName(displayName);

      // Set condition
      if (item.condition === 'New' || item.condition === 'Used') {
        setCondition(item.condition);

        // Auto-select matching template
        if (templates && templates.length > 0) {
          const matchingTemplate = templates.find(
            (t) =>
              (item.condition === 'Used' && t.type === 'lego_used') ||
              (item.condition === 'New' && t.type === 'lego_new')
          );
          if (matchingTemplate) {
            setTemplateId(matchingTemplate.id);
          }
        }
      }

      // Add notes to key points
      if (item.notes) {
        setKeyPoints(item.notes);
      }

      // Store the inventory item ID for linking
      setImportedInventoryId(item.id);

      toast({ title: 'Item imported', description: displayName });
    },
    [templates, toast]
  );

  const handleGenerate = async () => {
    if (!itemName.trim()) {
      toast({
        title: 'Item name required',
        description: 'Please enter an item name or description.',
        variant: 'destructive',
      });
      return;
    }

    if (!templateId) {
      toast({
        title: 'Template required',
        description: 'Please select a template.',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Use first image for generation if available
      const imageBase64 = images.length > 0 ? images[0].base64 : undefined;

      const response = await generateMutation.mutateAsync({
        item: itemName,
        condition,
        keyPoints,
        templateId,
        tone,
        imageBase64,
        inventoryItemId: importedInventoryId || inventoryItemId || undefined,
      });

      setResult(response);
      toast({ title: 'Listing generated successfully!' });
    } catch (error) {
      toast({
        title: 'Generation failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleCopyHtml = useCallback(() => {
    navigator.clipboard.writeText(editedDescription);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'HTML copied to clipboard' });
  }, [editedDescription, toast]);

  const handleSave = async () => {
    if (!result) return;

    try {
      await saveMutation.mutateAsync({
        item_name: itemName,
        condition,
        title: editedTitle,
        price_range: result.priceRange,
        description: editedDescription,
        template_id: templateId,
        ebay_sold_data: result.ebaySoldItems,
        inventory_item_id: importedInventoryId || inventoryItemId || null,
        status: 'draft',
      });

      toast({ title: 'Listing saved to history' });
    } catch (error) {
      toast({
        title: 'Failed to save',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  if (templatesLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Input Section */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Item Details</CardTitle>
              <CardDescription>
                Enter the item information and let AI generate a professional listing.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportModalOpen(true)}
            >
              <Package className="mr-2 h-4 w-4" />
              Import from Inventory
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Item Name */}
          <div className="space-y-2">
            <Label htmlFor="item-name">Item Name / Description</Label>
            <Input
              id="item-name"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="e.g., LEGO 75192 Millennium Falcon"
            />
          </div>

          {/* Image Upload */}
          <div className="space-y-2">
            <Label>Product Images (Optional)</Label>
            <ImageUpload
              value={images}
              onChange={setImages}
            />
          </div>

          {/* Template & Condition Row */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="template">Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {templates?.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Condition</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={condition === 'New' ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setCondition('New')}
                >
                  New
                </Button>
                <Button
                  type="button"
                  variant={condition === 'Used' ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setCondition('Used')}
                >
                  Used
                </Button>
              </div>
            </div>
          </div>

          {/* Tone */}
          <div className="space-y-2">
            <Label htmlFor="tone">Writing Tone</Label>
            <Select value={tone} onValueChange={(v: string) => setTone(v as ListingTone)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LISTING_TONES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex flex-col">
                      <span>{t.label}</span>
                      <span className="text-xs text-muted-foreground">{t.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Key Points */}
          <div className="space-y-2">
            <Label htmlFor="key-points">Key Points (Optional)</Label>
            <Textarea
              id="key-points"
              value={keyPoints}
              onChange={(e) => setKeyPoints(e.target.value)}
              placeholder="Add any specific details, condition notes, or selling points..."
              rows={3}
            />
          </div>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending || !itemName.trim()}
            className="w-full"
          >
            {generateMutation.isPending ? (
              <>
                <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate Listing
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Output Section */}
      <Card>
        <CardHeader>
          <CardTitle>Generated Listing</CardTitle>
          <CardDescription>
            Review and edit the generated listing before saving.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!result ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Sparkles className="h-12 w-12 mb-4" />
              <p>Enter item details and click Generate to create a listing.</p>
            </div>
          ) : (
            <>
              {/* Title */}
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  maxLength={80}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {editedTitle.length}/80 characters
                </p>
              </div>

              {/* Price & Condition */}
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-sm">
                  {result.priceRange}
                </Badge>
                <Badge className={CONDITION_COLORS[condition]}>
                  {condition}
                </Badge>
              </div>

              {/* eBay Sold Items */}
              {result.ebaySoldItems && result.ebaySoldItems.length > 0 && (
                <Collapsible open={soldItemsOpen} onOpenChange={setSoldItemsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full justify-between">
                      <span>
                        eBay Sold Prices ({result.ebaySoldItems.length} items)
                      </span>
                      {soldItemsOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <EbaySoldItemsDisplay items={result.ebaySoldItems} />
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Description Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Description</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowHtml(!showHtml)}
                  >
                    {showHtml ? (
                      <>
                        <Eye className="mr-2 h-4 w-4" />
                        Preview
                      </>
                    ) : (
                      <>
                        <Code className="mr-2 h-4 w-4" />
                        HTML
                      </>
                    )}
                  </Button>
                </div>

                {showHtml ? (
                  <HtmlSourceEditor
                    value={editedDescription}
                    onChange={setEditedDescription}
                    className="min-h-[300px]"
                  />
                ) : (
                  <RichTextEditor
                    value={editedDescription}
                    onChange={setEditedDescription}
                    className="min-h-[300px]"
                  />
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleCopyHtml}
                >
                  {copied ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy HTML
                    </>
                  )}
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? (
                    'Saving...'
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save to History
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Import from Inventory Modal */}
      <InventoryImportModal
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        onSelect={handleImportInventoryItem}
      />
    </div>
  );
}
