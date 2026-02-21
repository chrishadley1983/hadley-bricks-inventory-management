'use client';

import { useCallback, useState } from 'react';
import {
  Image as ImageIcon,
  Download,
  Trash2,
  RotateCcw,
  SunMedium,
  Moon,
  ZoomIn,
  ZoomOut,
  Sparkles,
  AlertCircle,
  Upload,
  X,
  FolderOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { processImage, generateFilename } from '@/lib/listing-assistant/image-processing';
import { useImageProcessor } from '@/hooks/listing-assistant';
import {
  SLIDER_CONFIG,
  IMAGE_PRESETS,
  EBAY_OPTIMIZE_SETTINGS,
} from '@/lib/listing-assistant/constants';
import { cn } from '@/lib/utils';

export function ImageStudioTab() {
  const {
    images,
    selectedId,
    selectedImage,
    setSelectedId,
    addImages,
    removeImage,
    updateSettings,
    resetSettings,
    applyPreset,
    analyzeImage,
    downloadSingle,
    downloadAll,
    clearAll,
    isAnalyzing,
  } = useImageProcessor();

  const { toast } = useToast();
  const [isZoomed, setIsZoomed] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMode, setSaveMode] = useState<'single' | 'all'>('all');

  // Save images to a user-selected folder using File System Access API
  const handleSaveToFolder = useCallback(async () => {
    // Check if File System Access API is supported
    if (!('showDirectoryPicker' in window)) {
      toast({
        title: 'Not supported',
        description:
          'Your browser does not support folder selection. Images will be downloaded to your default downloads folder.',
        variant: 'destructive',
      });
      // Fallback to regular download
      if (saveMode === 'single' && selectedId) {
        downloadSingle(selectedId);
      } else {
        downloadAll();
      }
      setIsSaveDialogOpen(false);
      return;
    }

    try {
      // Request folder access
      const dirHandle = await (
        window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
      ).showDirectoryPicker();

      setIsSaving(true);
      const imagesToSave = saveMode === 'single' && selectedImage ? [selectedImage] : images;

      let savedCount = 0;
      for (let i = 0; i < imagesToSave.length; i++) {
        const image = imagesToSave[i];
        try {
          // Process the image
          const processed = await processImage(image.original, image.settings);
          const filename = generateFilename(image.name, i);

          // Convert base64 to blob
          const response = await fetch(processed);
          const blob = await response.blob();

          // Create file in the selected folder
          const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();

          savedCount++;
        } catch (error) {
          console.error('Failed to save image:', image.name, error);
        }
      }

      setIsSaving(false);
      setIsSaveDialogOpen(false);

      toast({
        title: 'Images saved',
        description: `Successfully saved ${savedCount} image${savedCount !== 1 ? 's' : ''} to the selected folder.`,
      });
    } catch (error) {
      setIsSaving(false);
      // User cancelled the folder picker or permission denied
      if ((error as Error).name === 'AbortError') {
        return; // User cancelled, do nothing
      }
      console.error('Failed to save images:', error);
      toast({
        title: 'Save failed',
        description: 'Could not save images to the selected folder. Please try again.',
        variant: 'destructive',
      });
    }
  }, [saveMode, selectedId, selectedImage, images, downloadSingle, downloadAll, toast]);

  const openSaveDialog = useCallback((mode: 'single' | 'all') => {
    setSaveMode(mode);
    setIsSaveDialogOpen(true);
  }, []);

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        addImages(files);
      }
    },
    [addImages]
  );

  const handleFileSelect = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length > 0) {
        addImages(files);
      }
    };
    input.click();
  }, [addImages]);

  const handleAnalyze = useCallback(async () => {
    if (!selectedId) return;
    try {
      await analyzeImage(selectedId);
      toast({ title: 'Image analyzed successfully' });
    } catch {
      toast({
        title: 'Analysis failed',
        description: 'Could not analyze the image. Please try again.',
        variant: 'destructive',
      });
    }
  }, [selectedId, analyzeImage, toast]);

  // No images state
  if (images.length === 0) {
    return (
      <Card
        className="p-8 text-center cursor-pointer hover:bg-muted/50 transition-colors"
        onDrop={handleFileDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={handleFileSelect}
      >
        <ImageIcon className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">Image Studio</h3>
        <p className="mt-2 text-sm text-muted-foreground">Drop images here or click to upload</p>
        <p className="text-xs text-muted-foreground mt-1">
          Optimize your product photos with brightness, contrast, and AI analysis
        </p>
        <Button className="mt-4">
          <Upload className="mr-2 h-4 w-4" />
          Upload Images
        </Button>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Left: Thumbnail Gallery */}
      <div className="lg:col-span-1">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Images ({images.length})</CardTitle>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={handleFileSelect}>
                  <Upload className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={clearAll} disabled={images.length === 0}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div
              className="grid grid-cols-3 gap-2"
              onDrop={handleFileDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              {images.map((image) => (
                <div
                  key={image.id}
                  className={cn(
                    'relative aspect-square cursor-pointer rounded-md overflow-hidden border-2 transition-colors',
                    selectedId === image.id
                      ? 'border-primary'
                      : 'border-transparent hover:border-muted-foreground/50'
                  )}
                  onClick={() => setSelectedId(image.id)}
                >
                  <img
                    src={image.processed || image.original}
                    alt={image.name}
                    className="h-full w-full object-cover"
                  />
                  {image.isProcessing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                      <Skeleton className="h-6 w-6 rounded-full" />
                    </div>
                  )}
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-1 right-1 h-5 w-5 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(image.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}

              {/* Add more button */}
              <div
                className="aspect-square rounded-md border-2 border-dashed border-muted-foreground/25 flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={handleFileSelect}
              >
                <Upload className="h-6 w-6 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Download Actions */}
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => openSaveDialog('single')}
            disabled={!selectedId}
          >
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => openSaveDialog('all')}
            disabled={images.length === 0}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            Save All
          </Button>
        </div>
      </div>

      {/* Center: Preview */}
      <div className="lg:col-span-1">
        <Card className="h-full">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedImage ? (
              <button
                type="button"
                onClick={() => setIsZoomed(true)}
                className="w-full aspect-square bg-white rounded-lg overflow-hidden border cursor-zoom-in hover:ring-2 hover:ring-primary/50 transition-all"
              >
                <img
                  src={selectedImage.processed || selectedImage.original}
                  alt={selectedImage.name}
                  className="h-full w-full object-contain"
                />
              </button>
            ) : (
              <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Select an image</p>
              </div>
            )}
            {selectedImage && (
              <p className="text-xs text-muted-foreground text-center mt-2">Click image to zoom</p>
            )}

            {/* AI Analysis Results */}
            {selectedImage?.analysis && (
              <div className="mt-4 space-y-2">
                <Label className="text-xs">AI Analysis</Label>
                <div className="rounded-md border p-3 text-sm space-y-2">
                  <div>
                    <span className="font-medium">Alt Text:</span>
                    <p className="text-muted-foreground">{selectedImage.analysis.altText}</p>
                  </div>
                  {selectedImage.analysis.defectsNote && (
                    <Alert variant="destructive" className="py-2">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle className="text-xs">Defects Detected</AlertTitle>
                      <AlertDescription className="text-xs">
                        {selectedImage.analysis.defectsNote}
                      </AlertDescription>
                    </Alert>
                  )}
                  <div>
                    <span className="font-medium">Filename:</span>
                    <p className="text-muted-foreground">
                      {selectedImage.analysis.suggestedFilename}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Zoom Modal */}
        <Dialog open={isZoomed} onOpenChange={setIsZoomed}>
          <DialogContent className="max-w-[75vw] max-h-[75vh] p-0 overflow-hidden bg-black/95 border-none">
            {selectedImage && (
              <div className="relative flex items-center justify-center w-full h-full">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 z-10 text-white hover:bg-white/20"
                  onClick={() => setIsZoomed(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
                <img
                  src={selectedImage.processed || selectedImage.original}
                  alt={selectedImage.name}
                  className="max-w-full max-h-[70vh] object-contain"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white p-3 text-center">
                  <span className="text-sm">{selectedImage.name}</span>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Save to Folder Dialog */}
      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              {saveMode === 'single'
                ? 'Save Image'
                : `Save ${images.length} Image${images.length !== 1 ? 's' : ''}`}
            </DialogTitle>
            <DialogDescription>
              Choose a folder on your computer to save the processed{' '}
              {saveMode === 'single' ? 'image' : 'images'}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground mb-4">
              Click the button below to select a folder. Your browser will ask for permission to
              save files.
            </p>
            {saveMode === 'all' && images.length > 1 && (
              <div className="bg-muted rounded-md p-3 text-sm">
                <p className="font-medium mb-2">Files to save:</p>
                <ul className="text-muted-foreground space-y-1 text-xs">
                  {images.slice(0, 5).map((img, i) => (
                    <li key={img.id} className="truncate" title={generateFilename(img.name, i)}>
                      {generateFilename(img.name, i)}
                    </li>
                  ))}
                  {images.length > 5 && (
                    <li className="text-muted-foreground/70">...and {images.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsSaveDialogOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveToFolder} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Choose Folder
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Right: Controls */}
      <div className="lg:col-span-1">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Adjustments</CardTitle>
            <CardDescription className="text-xs">Fine-tune your image settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedImage ? (
              <>
                {/* Optimise for eBay - Primary Action */}
                <Button
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600"
                  size="lg"
                  onClick={() => {
                    applyPreset(selectedId!, EBAY_OPTIMIZE_SETTINGS);
                    toast({
                      title: 'Optimised for eBay',
                      description:
                        'Settings adjusted for eBay best practices. Review the sliders to fine-tune.',
                    });
                  }}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Optimise for eBay
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  One-click professional photo optimization: brightness, contrast, sharpness, and
                  temperature
                </p>

                {/* Quick Actions */}
                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      updateSettings(selectedId!, {
                        brightness: selectedImage.settings.brightness + 0.1,
                      })
                    }
                  >
                    <SunMedium className="mr-1 h-3 w-3" />
                    Brighter
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      updateSettings(selectedId!, {
                        brightness: selectedImage.settings.brightness - 0.1,
                      })
                    }
                  >
                    <Moon className="mr-1 h-3 w-3" />
                    Darker
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      updateSettings(selectedId!, {
                        padding: Math.min(0.3, selectedImage.settings.padding + 0.05),
                      })
                    }
                  >
                    <ZoomOut className="mr-1 h-3 w-3" />
                    Zoom Out
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      updateSettings(selectedId!, {
                        padding: Math.max(0.05, selectedImage.settings.padding - 0.05),
                      })
                    }
                  >
                    <ZoomIn className="mr-1 h-3 w-3" />
                    Zoom In
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset(selectedId!, IMAGE_PRESETS.highContrast)}
                  >
                    High Contrast
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => resetSettings(selectedId!)}>
                    <RotateCcw className="mr-1 h-3 w-3" />
                    Reset
                  </Button>
                </div>

                {/* Sliders */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <Label>Brightness</Label>
                      <span className="text-muted-foreground">
                        {selectedImage.settings.brightness.toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      value={[selectedImage.settings.brightness]}
                      min={SLIDER_CONFIG.brightness.min}
                      max={SLIDER_CONFIG.brightness.max}
                      step={SLIDER_CONFIG.brightness.step}
                      onValueChange={([value]: number[]) =>
                        updateSettings(selectedId!, { brightness: value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <Label>Contrast</Label>
                      <span className="text-muted-foreground">
                        {selectedImage.settings.contrast.toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      value={[selectedImage.settings.contrast]}
                      min={SLIDER_CONFIG.contrast.min}
                      max={SLIDER_CONFIG.contrast.max}
                      step={SLIDER_CONFIG.contrast.step}
                      onValueChange={([value]: number[]) =>
                        updateSettings(selectedId!, { contrast: value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <Label>Sharpness</Label>
                      <span className="text-muted-foreground">
                        {selectedImage.settings.sharpness.toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      value={[selectedImage.settings.sharpness]}
                      min={SLIDER_CONFIG.sharpness.min}
                      max={SLIDER_CONFIG.sharpness.max}
                      step={SLIDER_CONFIG.sharpness.step}
                      onValueChange={([value]: number[]) =>
                        updateSettings(selectedId!, { sharpness: value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <Label>Padding</Label>
                      <span className="text-muted-foreground">
                        {Math.round(selectedImage.settings.padding * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[selectedImage.settings.padding]}
                      min={SLIDER_CONFIG.padding.min}
                      max={SLIDER_CONFIG.padding.max}
                      step={SLIDER_CONFIG.padding.step}
                      onValueChange={([value]: number[]) =>
                        updateSettings(selectedId!, { padding: value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <Label>Temperature</Label>
                      <span className="text-muted-foreground">
                        {selectedImage.settings.temperature > 0
                          ? `+${selectedImage.settings.temperature}`
                          : selectedImage.settings.temperature}
                      </span>
                    </div>
                    <Slider
                      value={[selectedImage.settings.temperature]}
                      min={SLIDER_CONFIG.temperature.min}
                      max={SLIDER_CONFIG.temperature.max}
                      step={SLIDER_CONFIG.temperature.step}
                      onValueChange={([value]: number[]) =>
                        updateSettings(selectedId!, { temperature: value })
                      }
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Cool</span>
                      <span>Warm</span>
                    </div>
                  </div>
                </div>

                {/* AI Analysis Button */}
                <div className="pt-4 border-t">
                  <Button
                    className="w-full"
                    onClick={handleAnalyze}
                    disabled={isAnalyzing || selectedImage.isAnalyzing}
                  >
                    {selectedImage.isAnalyzing || isAnalyzing ? (
                      <>
                        <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Analyze with AI
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    Get alt text, defect detection, and filename suggestions
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Select an image to adjust settings
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
