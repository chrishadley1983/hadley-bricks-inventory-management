'use client';

import * as React from 'react';
import { Upload, X, Camera, FileText, Settings2, Clipboard, Gavel } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useImageDrop, type UploadedImage } from '@/hooks/use-photo-analysis';
import type { TargetPlatform } from '@/lib/purchase-evaluator';
import type { PrimaryAnalysisModel, AuctionSettings } from '@/lib/purchase-evaluator/photo-types';

// ============================================
// Types
// ============================================

interface PhotoInputStepProps {
  images: UploadedImage[];
  onAddImages: (files: FileList | File[]) => void;
  onRemoveImage: (id: string) => void;
  listingDescription: string;
  onListingDescriptionChange: (value: string) => void;
  targetMarginPercent: number;
  onTargetMarginChange: (value: number) => void;
  defaultPlatform: TargetPlatform;
  onDefaultPlatformChange: (value: TargetPlatform) => void;
  primaryModel: PrimaryAnalysisModel;
  onPrimaryModelChange: (value: PrimaryAnalysisModel) => void;
  useGeminiVerification: boolean;
  onUseGeminiVerificationChange: (value: boolean) => void;
  useBrickognize: boolean;
  onUseBrickognizeChange: (value: boolean) => void;
  useImageChunking: boolean;
  onUseImageChunkingChange: (value: boolean) => void;
  auctionSettings: AuctionSettings;
  onAuctionSettingsChange: (settings: AuctionSettings) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  progressMessage?: string | null;
  canAnalyze: boolean;
}

// ============================================
// Component
// ============================================

export function PhotoInputStep({
  images,
  onAddImages,
  onRemoveImage,
  listingDescription,
  onListingDescriptionChange,
  useImageChunking,
  onUseImageChunkingChange,
  targetMarginPercent,
  onTargetMarginChange,
  defaultPlatform,
  onDefaultPlatformChange,
  primaryModel,
  onPrimaryModelChange,
  useGeminiVerification,
  onUseGeminiVerificationChange,
  useBrickognize,
  onUseBrickognizeChange,
  auctionSettings,
  onAuctionSettingsChange,
  onAnalyze,
  isAnalyzing,
  progressMessage,
  canAnalyze,
}: PhotoInputStepProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const dropZoneRef = React.useRef<HTMLDivElement>(null);
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const { isDragging, dragHandlers } = useImageDrop((files) => {
    onAddImages(files);
  });

  // Handle paste events for clipboard images
  React.useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Only process if we're not at the image limit
      if (images.length >= 10) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            // Create a more descriptive filename for pasted images
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const extension = item.type.split('/')[1] || 'png';
            const renamedFile = new File([file], `pasted-image-${timestamp}.${extension}`, {
              type: file.type,
            });
            imageFiles.push(renamedFile);
          }
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        onAddImages(imageFiles);
      }
    };

    // Add paste listener to document
    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [images.length, onAddImages]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddImages(e.target.files);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handlePasteFromClipboard = async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      const imageFiles: File[] = [];

      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const extension = type.split('/')[1] || 'png';
            const file = new File([blob], `pasted-image-${timestamp}.${extension}`, {
              type: blob.type,
            });
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        onAddImages(imageFiles);
      }
    } catch (error) {
      // Clipboard API may not be available or permission denied
      console.warn('Could not read from clipboard:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Photo Upload Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Upload Photos
          </CardTitle>
          <CardDescription>
            Upload photos of the LEGO lot you want to evaluate. Our AI will identify sets,
            minifigures, and parts, then assess their condition.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drop Zone */}
          <div
            ref={dropZoneRef}
            {...dragHandlers}
            className={cn(
              'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50',
              images.length >= 10 && 'opacity-50 pointer-events-none'
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              disabled={images.length >= 10}
            />

            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />

            <p className="text-sm text-muted-foreground mb-2">
              {isDragging
                ? 'Drop images here...'
                : 'Drag and drop images here, paste from clipboard (Ctrl+V), or'}
            </p>

            <div className="flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={handleBrowseClick}
                disabled={images.length >= 10}
              >
                Browse Files
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handlePasteFromClipboard}
                disabled={images.length >= 10}
              >
                <Clipboard className="mr-2 h-4 w-4" />
                Paste from Clipboard
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mt-4">
              Supports JPEG, PNG, WebP, GIF. Maximum 10 images. You can also press Ctrl+V anywhere
              on this page.
            </p>
          </div>

          {/* Image Previews */}
          {images.length > 0 && (
            <div className="space-y-2">
              <Label>Uploaded Images ({images.length}/10)</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {images.map((image) => (
                  <div
                    key={image.id}
                    className="relative group aspect-square rounded-lg overflow-hidden border"
                  >
                    <img
                      src={image.preview}
                      alt={image.file.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onRemoveImage(image.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                      <p className="text-xs text-white truncate">{image.file.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Listing Description Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Listing Description (Optional)
          </CardTitle>
          <CardDescription>
            Paste the seller&apos;s listing description to help with identification. This is useful
            for auction screenshots where set numbers may not be visible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Paste the listing description here..."
            value={listingDescription}
            onChange={(e) => onListingDescriptionChange(e.target.value)}
            rows={4}
            className="resize-none"
          />
        </CardContent>
      </Card>

      {/* Target Margin Card */}
      <Card>
        <CardHeader>
          <CardTitle>Target Profit Margin</CardTitle>
          <CardDescription>
            Set your desired profit margin to calculate the maximum purchase price.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Target Margin</Label>
              <span className="text-sm font-medium">{targetMarginPercent}%</span>
            </div>
            <Slider
              value={[targetMarginPercent]}
              onValueChange={([value]: number[]) => onTargetMarginChange(value)}
              min={20}
              max={50}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>20% (Aggressive)</span>
              <span>35% (Balanced)</span>
              <span>50% (Conservative)</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Default Platform</Label>
            <Select
              value={defaultPlatform}
              onValueChange={(v: string) => onDefaultPlatformChange(v as TargetPlatform)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="amazon">Amazon</SelectItem>
                <SelectItem value="ebay">eBay</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Platform used for price lookups and fee calculations.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Auction Mode Card */}
      <Card className={cn(auctionSettings.enabled && 'border-amber-300 bg-amber-50/30')}>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gavel className="h-5 w-5" />
              <div>
                <CardTitle>Auction Mode</CardTitle>
                <CardDescription>
                  Account for auction house commission and shipping in bid calculations.
                </CardDescription>
              </div>
            </div>
            <Switch
              checked={auctionSettings.enabled}
              onCheckedChange={(checked: boolean) =>
                onAuctionSettingsChange({ ...auctionSettings, enabled: checked })
              }
            />
          </div>
        </CardHeader>

        {auctionSettings.enabled && (
          <CardContent className="space-y-4 pt-0">
            {/* Commission % Input */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="commission">Commission Rate</Label>
                <span className="text-sm font-medium">{auctionSettings.commissionPercent}%</span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="commission"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  className="w-28"
                  value={auctionSettings.commissionPercent}
                  onChange={(e) =>
                    onAuctionSettingsChange({
                      ...auctionSettings,
                      commissionPercent: parseFloat(e.target.value) || 0,
                    })
                  }
                />
                <span className="text-sm text-muted-foreground">% (inc. VAT/fees)</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Total buyer&apos;s premium including VAT and fees. Common UK auction rate is 32.94%.
              </p>
            </div>

            {/* Shipping Cost Input */}
            <div className="space-y-2">
              <Label htmlFor="auction-shipping">Estimated Shipping</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">£</span>
                <Input
                  id="auction-shipping"
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-28"
                  value={auctionSettings.shippingCost}
                  onChange={(e) =>
                    onAuctionSettingsChange({
                      ...auctionSettings,
                      shippingCost: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Shipping cost from auction house to you (for the entire lot).
              </p>
            </div>

            {/* Info Box */}
            <div className="rounded-md bg-amber-100 p-3 text-sm">
              <p className="text-amber-800">
                <strong>How it works:</strong> We&apos;ll calculate the maximum bid you should
                enter, accounting for commission and shipping. The &quot;Total Paid&quot; will equal
                your target maximum purchase price.
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Advanced Options */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings2 className="h-5 w-5" />
                  <CardTitle>Advanced Options</CardTitle>
                </div>
                <span className="text-sm text-muted-foreground">
                  {showAdvanced ? 'Hide' : 'Show'}
                </span>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              {/* Primary AI Model Selection */}
              <div className="space-y-2">
                <Label>Primary AI Model</Label>
                <Select
                  value={primaryModel}
                  onValueChange={(v: string) => onPrimaryModelChange(v as PrimaryAnalysisModel)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini">Gemini Pro (Recommended)</SelectItem>
                    <SelectItem value="claude">Claude Opus</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {primaryModel === 'gemini'
                    ? 'Gemini Pro excels at reading set numbers from box images. Claude validates the results.'
                    : 'Claude Opus provides detailed condition analysis. Gemini validates set numbers.'}
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>
                    {primaryModel === 'gemini' ? 'Claude Verification' : 'Gemini Verification'}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Cross-check set numbers with {primaryModel === 'gemini' ? 'Claude' : 'Gemini'}{' '}
                    for higher accuracy.
                  </p>
                </div>
                <Switch
                  checked={useGeminiVerification}
                  onCheckedChange={onUseGeminiVerificationChange}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Brickognize Identification</Label>
                  <p className="text-xs text-muted-foreground">
                    Use Brickognize AI for specialized part and minifig identification.
                  </p>
                </div>
                <Switch checked={useBrickognize} onCheckedChange={onUseBrickognizeChange} />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Smart Image Chunking</Label>
                  <p className="text-xs text-muted-foreground">
                    Pre-process images to isolate individual items for more accurate identification.
                    Uses AI to detect item regions and analyze each separately.
                  </p>
                </div>
                <Switch checked={useImageChunking} onCheckedChange={onUseImageChunkingChange} />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Analyze Button */}
      <div className="flex justify-end">
        <Button onClick={onAnalyze} disabled={!canAnalyze} size="lg" className="min-w-[200px]">
          {isAnalyzing ? (
            <>
              <span className="animate-spin mr-2">⏳</span>
              {progressMessage || 'Analyzing...'}
            </>
          ) : (
            <>
              <Camera className="mr-2 h-4 w-4" />
              Analyze Photos
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
