# Image Studio

## Overview

The Image Studio is a browser-based photo editor for optimizing product images before uploading to eBay. It provides quick adjustments, one-click eBay optimization, and AI-powered image analysis.

## Accessing Image Studio

**Navigation**: Dashboard sidebar → Listing Assistant → Image Studio tab

## Getting Started

### Adding Images

**Drag and Drop:**
- Drag image files onto the upload area
- Multiple images supported
- Accepts common formats (JPG, PNG, WebP)

**Click to Upload:**
- Click the upload area or button
- Select files from your computer
- Multiple selection allowed

## Interface Layout

The Image Studio has three columns:

### Left: Thumbnail Gallery

- Grid of uploaded images
- Click to select for editing
- Selected image has blue border
- Trash icon to remove individual images
- Upload button to add more

### Center: Preview

- Large preview of selected image
- Click to zoom full-screen
- Shows processed result
- AI analysis results (if analyzed)

### Right: Adjustments

- Quick action buttons
- Slider controls
- AI analysis button

## Adjustments

### One-Click eBay Optimization

The **Optimise for eBay** button applies professional settings:
- Brightness: +10%
- Contrast: +15%
- Sharpness: +20%
- Temperature: Slightly warm

This creates product photos that stand out in eBay search results.

### Quick Actions

| Button | Effect |
|--------|--------|
| **Brighter** | Increase brightness +0.1 |
| **Darker** | Decrease brightness -0.1 |
| **Zoom Out** | Add padding (white border) |
| **Zoom In** | Reduce padding |
| **High Contrast** | Apply high contrast preset |
| **Reset** | Restore original image |

### Slider Controls

| Slider | Range | Description |
|--------|-------|-------------|
| **Brightness** | 0.5 - 2.0 | Light/dark adjustment |
| **Contrast** | 0.5 - 2.0 | Color separation |
| **Sharpness** | 0 - 2.0 | Edge enhancement |
| **Padding** | 5% - 30% | White border around image |
| **Temperature** | -30 to +30 | Cool (blue) to warm (yellow) |

### Temperature Guide

- **Negative values**: Cooler, bluer tones
- **Zero**: Neutral, no color shift
- **Positive values**: Warmer, yellower tones

For product photos, slightly warm (+5 to +10) often looks best.

## AI Image Analysis

Click **Analyze with AI** to get:

| Output | Description |
|--------|-------------|
| **Alt Text** | SEO-friendly image description |
| **Defects Note** | Any visible damage or issues |
| **Suggested Filename** | Descriptive filename for SEO |

### Analysis Results

Results appear below the preview:
- Alt text ready to copy
- Defects highlighted in red alert
- Filename suggestion for saving

### Use Cases

- Generate alt text for accessibility
- Spot defects before listing
- Create descriptive filenames
- Improve listing SEO

## Saving Images

### Download Single

1. Select an image
2. Click **Download** button
3. Processed image downloads to your default folder

### Save All to Folder

1. Click **Save All** button
2. Dialog shows files to be saved
3. Click **Choose Folder**
4. Select destination folder
5. Grant browser permission
6. All processed images saved

**Note**: Save to Folder requires a modern browser with File System Access API support.

## Presets

### eBay Optimize

Optimized for eBay product photography:
- Bright, clear images
- Enhanced contrast
- Sharp details
- Professional look

### High Contrast

For items that need to "pop":
- Significantly increased contrast
- Good for detailed items
- May lose some shadow detail

## Technical Details

### Processing

All image processing happens in the browser:
- No server upload required
- Privacy preserved
- Fast processing
- Canvas API manipulation

### Supported Formats

| Input | Output |
|-------|--------|
| JPEG | JPEG |
| PNG | PNG (preserves transparency) |
| WebP | JPEG |
| BMP | JPEG |

### File Naming

Saved files use the pattern:
```
{original-name}-ebay-{index}.jpg
```

Example: `millennium-falcon-ebay-01.jpg`

### Size Limits

- No strict size limit
- Very large images may be slow
- eBay recommends 1600px on longest side

## Best Practices

### For Product Photos

1. Start with good lighting
2. Use the eBay Optimize preset
3. Adjust brightness if needed
4. Add slight padding for breathing room
5. Analyze for defects before listing

### For Multiple Images

1. Upload all product angles
2. Apply same settings to maintain consistency
3. Use Save All to batch export
4. Keep filenames descriptive

### Quality Tips

- Don't over-sharpen (creates halos)
- Don't over-brighten (loses detail)
- Subtle adjustments work best
- Check at 100% zoom before saving

## Troubleshooting

### Image not processing
- Try a smaller file
- Refresh the page
- Check browser console for errors

### Colors look wrong
- Reset temperature to 0
- Check your monitor calibration
- View on different device

### Save to folder not working
- Use Chrome, Edge, or modern Firefox
- Grant folder permission when prompted
- Falls back to regular download if unsupported

### AI analysis slow
- Large images take longer
- API may be rate limited
- Try again after a moment

## Related Files

| File | Purpose |
|------|---------|
| `apps/web/src/components/features/listing-assistant/tabs/ImageStudioTab.tsx` | Main UI |
| `apps/web/src/hooks/listing-assistant/use-image-processor.ts` | Processing state |
| `apps/web/src/lib/listing-assistant/image-processing.ts` | Canvas operations |
| `apps/web/src/lib/listing-assistant/constants.ts` | Slider configs, presets |
