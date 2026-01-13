# eBay Listing Assistant - Integration Specification

## Overview

This specification describes the integration of the eBay Listing Assistant functionality into the Hadley Bricks Inventory Management application as a new sidebar page with tabs.

### Source Application Summary

The eBay Listing Assistant is a standalone React/Vite application that provides:

1. **AI-Powered Listing Generation** - Creates eBay listing titles, descriptions, and price estimates using Claude Opus for text generation and Gemini for image analysis
2. **Image Studio** - Photo editing suite with auto-cropping, brightness/contrast adjustment, sharpening, and AI-powered defect detection/removal (Gemini)
3. **Template Management** - CRUD operations for HTML description templates (Used LEGO, New LEGO, Other Items)
4. **Listing History** - Saved generated listings for reference and reuse
5. **Inventory Integration** - Direct connection to Hadley Bricks inventory with "Push to eBay" workflow

### AI Provider Strategy

| Feature | Provider | Model |
|---------|----------|-------|
| Listing text generation | Claude | claude-opus-4-20250514 |
| Price estimation | Claude + eBay Finding API | claude-opus-4-20250514 |
| Image analysis (alt text, defects) | Gemini | gemini-2.5-flash |
| Image editing (defect removal) | Gemini | gemini-2.5-flash-image |

---

## Page Structure

### Sidebar Navigation

**Route:** `/listings` or `/listing-assistant`

**Sidebar Item:**
- Icon: Edit/Pencil icon (matching existing style)
- Label: "Listing Assistant"
- Position: Below existing inventory-related pages

### Tab Structure

The page contains 4 tabs matching the original application:

| Tab | Label | Icon | Description |
|-----|-------|------|-------------|
| 1 | Create Listing | Edit icon | Main AI generation interface |
| 2 | Image Studio | Camera icon | Photo editing suite |
| 3 | Templates | Document icon | Template management |
| 4 | History | Archive icon | Saved listings (with count badge) |

---

## Inventory Integration

### "Push to eBay" Workflow

A new button appears on inventory items when:
- `listing_platform = 'ebay'`
- `status = 'Backlog'`

**Button Location:** Inventory item detail view / action menu

**Button Behavior:**
1. Opens Listing Assistant page
2. Pre-populates Generator tab with inventory item data
3. Scrolls to Create Listing tab if not already active

### Pre-populated Fields from Inventory

| Generator Field | Inventory Source |
|-----------------|------------------|
| Item Name | `name` or `title` field |
| Condition | `condition` field (map to New/Used) |
| Key Points | `notes` or `description` field |
| Template | Auto-select based on category (LEGO → Used/New Lego template) |
| Image | First image from `images` array if available |

### Inventory Item Component Addition

```typescript
// components/inventory/InventoryItemActions.tsx

interface PushToEbayButtonProps {
  item: InventoryItem;
}

export function PushToEbayButton({ item }: PushToEbayButtonProps) {
  const router = useRouter();
  
  // Only show for eBay backlog items
  if (item.listing_platform !== 'ebay' || item.status !== 'Backlog') {
    return null;
  }
  
  const handlePush = () => {
    // Navigate with item data in query params or state
    router.push(`/listing-assistant?inventoryId=${item.id}`);
  };
  
  return (
    <Button onClick={handlePush} variant="secondary">
      <UploadIcon className="w-4 h-4 mr-2" />
      Push to eBay
    </Button>
  );
}
```

### Generated Listing → Inventory Link

When a listing is saved:
1. Store `inventory_item_id` reference in `generated_listings` table
2. Optionally update inventory item status to 'Listed' or 'Pending'
3. Store the generated eBay listing HTML for future reference

---

## Data Models

### Database Schema (Supabase)

```sql
-- Listing Templates
CREATE TABLE listing_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  content TEXT NOT NULL, -- HTML content
  type VARCHAR(20) NOT NULL DEFAULT 'custom', -- 'lego_used', 'lego_new', 'general', 'custom'
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Generated Listings
CREATE TABLE generated_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL, -- Link to source inventory
  item_name VARCHAR(255) NOT NULL,
  condition VARCHAR(10) NOT NULL, -- 'New', 'Used'
  title VARCHAR(255) NOT NULL,
  price_range VARCHAR(50),
  description TEXT NOT NULL, -- HTML content
  template_id UUID REFERENCES listing_templates(id) ON DELETE SET NULL,
  source_urls TEXT[], -- Grounding URLs from AI
  ebay_sold_data JSONB, -- Cached Finding API results
  status VARCHAR(20) DEFAULT 'draft', -- 'draft', 'ready', 'listed', 'sold'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Settings (extend existing or create)
CREATE TABLE listing_assistant_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  ebay_app_id VARCHAR(100), -- Optional eBay API key (if not using shared)
  default_tone VARCHAR(20) DEFAULT 'Minimalist',
  default_condition VARCHAR(10) DEFAULT 'Used',
  gemini_api_key VARCHAR(100), -- For image processing
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE listing_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_assistant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own templates" ON listing_templates
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own listings" ON generated_listings
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own settings" ON listing_assistant_settings
  FOR ALL USING (auth.uid() = user_id);

-- Index for inventory lookups
CREATE INDEX idx_generated_listings_inventory ON generated_listings(inventory_item_id);
CREATE INDEX idx_generated_listings_status ON generated_listings(status);
```

### TypeScript Types

```typescript
// packages/database/src/types/listing-assistant.ts

export interface ListingTemplate {
  id: string;
  user_id: string;
  name: string;
  content: string; // HTML
  type: 'lego_used' | 'lego_new' | 'general' | 'custom';
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface GeneratedListing {
  id: string;
  user_id: string;
  inventory_item_id: string | null; // Link to source inventory
  item_name: string;
  condition: 'New' | 'Used';
  title: string;
  price_range: string | null;
  description: string; // HTML
  template_id: string | null;
  source_urls: string[] | null;
  ebay_sold_data: EbaySoldItem[] | null; // Cached Finding API results
  status: 'draft' | 'ready' | 'listed' | 'sold';
  created_at: string;
}

export interface ListingAssistantSettings {
  id: string;
  user_id: string;
  ebay_app_id: string | null;
  default_tone: ListingTone;
  default_condition: 'New' | 'Used';
  gemini_api_key: string | null;
  created_at: string;
  updated_at: string;
}

export type ListingTone = 'Standard' | 'Professional' | 'Enthusiastic' | 'Friendly' | 'Minimalist';
export type ListingStatus = 'draft' | 'ready' | 'listed' | 'sold';

export interface ListingFormData {
  item: string;
  templateId: string;
  condition: 'New' | 'Used';
  keyPoints: string;
  tone: ListingTone;
  imageBase64?: string;
  inventoryItemId?: string; // Source inventory item
}

export interface GenerationResult {
  title: string;
  priceRange: string;
  description: string;
  groundingUrls?: string[];
  ebaySoldItems?: EbaySoldItem[]; // From Finding API
}

// eBay Finding API Types (from existing integration)
export interface EbaySoldItem {
  title: string;
  price: string;
  currency: string;
  date: string;
  url: string;
  imageUrl?: string;
  condition?: string;
}

export interface FindingAPIResponse {
  items: EbaySoldItem[];
  totalResults: number;
  searchUrl: string;
}

// Image Studio Types
export interface ImageProcessSettings {
  brightness: number;  // 1.0 is normal
  contrast: number;    // 1.0 is normal
  saturation: number;  // 1.0 is normal
  sharpness: number;   // 0 to 1 intensity
  padding: number;     // percentage 0.05 to 0.3
  temperature: number; // -50 to 50 (Cool to Warm)
}

export interface ImageAnalysisResult {
  altText: string;
  defectsNote?: string;
  suggestedFilename?: string;
}

export interface StudioImage {
  id: string;
  name: string;
  fileName: string;
  original: string;      // base64
  processed: string | null;
  settings: ImageProcessSettings;
  analysis: ImageAnalysisResult | null;
  isProcessing: boolean;
  isAnalyzing: boolean;
  isFixing: boolean;
}

// Inventory Integration Types
export interface InventoryItemForListing {
  id: string;
  name: string;
  condition: string;
  notes?: string;
  description?: string;
  category?: string;
  images?: string[];
  listing_platform: string;
  status: string;
  set_number?: string; // For LEGO items
}
```

---

## Component Architecture

### File Structure

```
apps/web/src/
├── app/
│   └── (dashboard)/
│       └── listing-assistant/
│           ├── page.tsx              # Main page with tabs
│           └── layout.tsx            # Optional layout wrapper
├── components/
│   └── listing-assistant/
│       ├── ListingAssistantPage.tsx  # Main container with tab state
│       ├── tabs/
│       │   ├── GeneratorTab.tsx      # Create Listing tab
│       │   ├── ImageStudioTab.tsx    # Image editing tab
│       │   ├── TemplatesTab.tsx      # Template management
│       │   └── HistoryTab.tsx        # Saved listings
│       ├── generator/
│       │   ├── ItemDetailsForm.tsx   # Input form
│       │   ├── GeneratedOutput.tsx   # Result display
│       │   └── ImageUpload.tsx       # Image upload component
│       ├── image-studio/
│       │   ├── ImageGallery.tsx      # Thumbnail strip
│       │   ├── ImagePreview.tsx      # Main preview area
│       │   ├── EditControls.tsx      # Sliders and buttons
│       │   └── AIAnalysisPanel.tsx   # AI insights display
│       ├── templates/
│       │   ├── TemplateList.tsx      # Grid of templates
│       │   └── TemplateEditor.tsx    # Edit form with RichTextEditor
│       ├── history/
│       │   └── ListingCard.tsx       # Individual listing display
│       ├── shared/
│       │   ├── RichTextEditor.tsx    # HTML WYSIWYG editor
│       │   └── SettingsModal.tsx     # eBay App ID settings
│       └── index.ts                  # Barrel exports
├── lib/
│   └── listing-assistant/
│       ├── ai-service.ts             # Claude/Gemini integration
│       ├── image-processing.ts       # Canvas-based image editing
│       ├── ebay-service.ts           # eBay API integration (optional)
│       └── constants.ts              # Default templates, settings
└── hooks/
    └── listing-assistant/
        ├── useTemplates.ts           # Template CRUD operations
        ├── useListings.ts            # Listing history operations
        ├── useImageProcessor.ts      # Image processing hook
        └── useSettings.ts            # User settings management
```

### Component Specifications

#### 1. ListingAssistantPage.tsx

**Props:** None (uses route params if needed)

**State:**
- `activeTab: 'generate' | 'studio' | 'templates' | 'history'`

**Behavior:**
- Renders tab navigation header
- Conditionally renders tab content
- Passes shared state (templates, listings) to children

---

#### 2. GeneratorTab.tsx

**Props:**
```typescript
interface GeneratorTabProps {
  templates: ListingTemplate[];
  onSaveListing: (listing: GeneratedListing) => void;
}
```

**State:**
- `formData: ListingFormData`
- `isGenerating: boolean`
- `error: string | null`
- `result: GenerationResult | null`
- `showHtml: boolean`

**Features:**
- Item name input with placeholder
- Image upload with preview and remove
- Template selector dropdown
- Condition toggle (New/Used)
- Tone selector dropdown
- Key points textarea
- Generate button with loading state
- Result display with:
  - Editable title
  - Price range badge
  - WYSIWYG description editor
  - Toggle for HTML source view
  - Copy HTML button
  - Save to History button
  - Source URLs display (if grounding available)

**AI Integration:**
- Uses Claude API (anthropic) or Gemini API
- System prompt for eBay listing generation
- Image analysis for product details
- Web search grounding for price estimation

---

#### 3. ImageStudioTab.tsx

**Props:** None (self-contained)

**State:**
- `images: StudioImage[]`
- `selectedId: string | null`

**Features:**
- Multi-image upload (drag & drop)
- Thumbnail gallery with selection
- Main preview area (1:1 square output)
- Edit controls:
  - Brightness slider (0.5 - 2.0)
  - Contrast slider (0.5 - 2.0)
  - Sharpness slider (0 - 1)
  - Padding slider (0% - 30%)
  - Temperature slider (-50 to +50)
- Quick action buttons:
  - Brighter +
  - Darker -
  - Zoom In
  - Zoom Out
  - Warmer
  - Cooler
  - High Contrast preset
  - Reset to Auto
- AI Analysis panel:
  - SEO alt text generation
  - Defect detection notes
  - Suggested filename
  - "Fix with AI" button for defect removal
- Export:
  - Download single image
  - Save All to folder (File System Access API)
  - Auto-numbered filenames

**Image Processing (Client-side):**
- Canvas-based transformations
- Brightness/contrast via CSS filters
- Temperature via RGB channel adjustment
- Sharpening via convolution kernel
- Smart crop via bounding box detection
- Square composition with white background
- JPEG output at 95% quality

---

#### 4. TemplatesTab.tsx

**Props:**
```typescript
interface TemplatesTabProps {
  templates: ListingTemplate[];
  onSave: (template: ListingTemplate) => void;
  onDelete: (id: string) => void;
}
```

**State:**
- `editingId: string | null`
- `formName: string`
- `formContent: string`

**Features:**
- Grid display of templates (cards)
- Each card shows:
  - Template name
  - HTML preview (truncated)
  - Edit button
  - Delete button (custom templates only)
- Create New Template button
- Edit mode:
  - Name input
  - RichTextEditor for content
  - Save/Cancel buttons

**Default Templates (seeded on first use):**
1. **Used Lego** - Set details, condition notes, shipping info, used items disclaimer
2. **New Lego** - Set details, box condition, returns policy
3. **Other Items** - Generic brand/model template

---

#### 5. HistoryTab.tsx

**Props:**
```typescript
interface HistoryTabProps {
  listings: GeneratedListing[];
  onDelete: (id: string) => void;
}
```

**Features:**
- List of saved listings
- Each card shows:
  - Title
  - Date created
  - Price range
  - Condition badge
  - Description preview (HTML rendered)
  - Copy HTML button
  - Delete button
- Empty state with helpful message

---

#### 6. RichTextEditor.tsx

**Props:**
```typescript
interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  className?: string;
  placeholder?: string;
}
```

**Implementation:**
- Uses `contentEditable` div
- Toolbar with: Bold, Italic, Underline, H2, H3, P, Bullet List, Numbered List, Clear Formatting
- Uses `document.execCommand` for formatting (or modern alternative like Tiptap/Slate)
- Syncs innerHTML with controlled value

---

## AI Service Integration

### Dual Provider Architecture

```typescript
// lib/listing-assistant/ai-service.ts

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

// Claude Opus for text generation
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Gemini for image processing
const gemini = new GoogleGenAI({ 
  apiKey: process.env.GOOGLE_AI_API_KEY 
});
```

### Claude Opus: Listing Generation

```typescript
export async function generateListing(
  item: string,
  condition: string,
  keyPoints: string,
  templateContent: string,
  tone: string,
  ebaySoldData?: EbaySoldItem[], // From Finding API
  imageAnalysis?: ImageAnalysisResult // From Gemini
): Promise<GenerationResult> {
  
  const systemPrompt = `You are an expert eBay seller assistant for Hadley Bricks, a LEGO resale business.
  
Your goal is to create compelling eBay listings that sell.

You will be provided with:
1. Item Name/Description
2. Condition (New/Used)
3. Key Points (Seller notes)
4. A Template (in HTML format)
5. Desired Tone
6. Recent eBay sold prices (from Finding API)
7. Image analysis results (if photo provided)

Your tasks:
1. Generate a catchy, SEO-friendly Title (max 80 characters)
   - Include key terms: brand, set number, name, condition indicator
   - Use power words that drive clicks
   
2. Estimate a fair market price range in GBP (£)
   - Use the provided eBay sold data as primary reference
   - Consider condition when comparing to sold items
   - Provide realistic range (e.g., "£45 - £55")
   
3. Fill out the provided HTML Template
   - PRESERVE all HTML structure (tags like <p>, <b>, <br>, <h3>, <hr>)
   - Replace placeholders like [Lookup] with actual data
   - Use image analysis details if provided
   - Write compelling description using Key Points
   - Adopt the requested tone: "${tone}"
   - Keep boilerplate shipping/returns text intact

CRITICAL: Return ONLY valid JSON. No markdown, no code blocks.

Output Schema:
{
  "title": "eBay Listing Title",
  "priceRange": "£XX - £YY",
  "description": "Full HTML template with all fields populated"
}`;

  const userPrompt = `
**Item:** ${item}
**Condition:** ${condition}
**Tone:** ${tone}
**Key Points:** ${keyPoints}

**Recent eBay Sold Prices (UK):**
${ebaySoldData?.length ? ebaySoldData.map(s => `- ${s.title}: ${s.price} (${s.date})`).join('\n') : 'No recent sales data available'}

**Image Analysis:**
${imageAnalysis ? `Alt Text: ${imageAnalysis.altText}\nNotes: ${imageAnalysis.defectsNote || 'None'}` : 'No image provided'}

**Template to Fill (HTML):**
"""
${templateContent}
"""
`;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return JSON.parse(extractJson(text));
}

function extractJson(text: string): string {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.substring(firstBrace, lastBrace + 1);
  }
  throw new Error('No valid JSON found in response');
}
```

### Gemini: Image Analysis

```typescript
export async function analyzeImage(imageBase64: string): Promise<ImageAnalysisResult> {
  const prompt = `Analyze this product image for an eBay listing.

1. Generate a 150-character SEO-optimized description suitable for an Image Alt-Tag.
2. Scan the image for potential defects (lens dust, scratches, dark spots on background, box damage).
3. Suggest a descriptive filename (use underscores, no extension).

For LEGO items, try to identify:
- Set number (if visible on box)
- Set name
- Box condition
- Any visible damage or wear

Output strictly in JSON format:
{
  "altText": "string",
  "defectsNote": "string (or null if none found)",
  "suggestedFilename": "string"
}

If defects are found, phrase the note helpfully like: "Note: I detected a dark spot on the upper left. Would you like me to attempt to remove it?"`;

  const parts = buildImageParts(imageBase64, prompt);

  const response = await gemini.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: { parts },
    config: { responseMimeType: 'application/json' }
  });

  const text = response.text;
  if (!text) throw new Error('No response from Gemini');
  
  return JSON.parse(text);
}
```

### Gemini: AI Image Editing

```typescript
export async function editImageWithAI(
  imageBase64: string, 
  instruction: string
): Promise<string> {
  const parts = buildImageParts(imageBase64, `Edit this image. ${instruction}`);

  const response = await gemini.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: { parts },
    config: {
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      const base64String = part.inlineData.data;
      const mimeType = part.inlineData.mimeType || 'image/jpeg';
      return `data:${mimeType};base64,${base64String}`;
    }
  }

  throw new Error('No edited image returned from Gemini');
}

function buildImageParts(imageBase64: string, textPrompt: string): any[] {
  const parts: any[] = [];
  
  const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
  if (matches) {
    parts.push({
      inlineData: { mimeType: matches[1], data: matches[2] }
    });
  } else {
    parts.push({
      inlineData: { mimeType: 'image/jpeg', data: imageBase64 }
    });
  }
  
  parts.push({ text: textPrompt });
  return parts;
}
```

### eBay Finding API: Price Research

```typescript
// lib/listing-assistant/ebay-finding-service.ts
// Uses existing Finding API integration from Hadley Bricks

import { findCompletedItems } from '@/lib/ebay/finding-api';

export async function getEbaySoldPrices(
  query: string,
  condition: 'New' | 'Used'
): Promise<EbaySoldItem[]> {
  const conditionId = condition === 'New' ? '1000' : '3000';
  
  const results = await findCompletedItems({
    keywords: query,
    itemFilter: [
      { name: 'Condition', value: conditionId },
      { name: 'SoldItemsOnly', value: 'true' }
    ],
    sortOrder: 'EndTimeSoonest',
    entriesPerPage: 10,
    globalId: 'EBAY-GB' // UK marketplace
  });

  return results.items.map(item => ({
    title: item.title,
    price: `£${item.sellingStatus.currentPrice.value}`,
    currency: item.sellingStatus.currentPrice.currencyId,
    date: new Date(item.listingInfo.endTime).toLocaleDateString('en-GB'),
    url: item.viewItemURL,
    imageUrl: item.galleryURL,
    condition: item.condition?.conditionDisplayName
  }));
}
```

---

## API Routes (Next.js App Router)

```typescript
// app/api/listing-assistant/generate/route.ts
import { generateListing } from '@/lib/listing-assistant/ai-service';
import { getEbaySoldPrices } from '@/lib/listing-assistant/ebay-finding-service';
import { analyzeImage } from '@/lib/listing-assistant/ai-service';

export async function POST(request: Request) {
  const { 
    item, 
    condition, 
    keyPoints, 
    templateContent, 
    tone, 
    imageBase64 
  } = await request.json();
  
  // 1. Get eBay sold prices via Finding API
  const ebaySoldData = await getEbaySoldPrices(item, condition);
  
  // 2. Analyze image if provided (Gemini)
  let imageAnalysis;
  if (imageBase64) {
    imageAnalysis = await analyzeImage(imageBase64);
  }
  
  // 3. Generate listing with Claude Opus
  const result = await generateListing(
    item, 
    condition, 
    keyPoints, 
    templateContent, 
    tone,
    ebaySoldData,
    imageAnalysis
  );
  
  return Response.json({
    ...result,
    ebaySoldItems: ebaySoldData
  });
}

// app/api/listing-assistant/analyze-image/route.ts
import { analyzeImage } from '@/lib/listing-assistant/ai-service';

export async function POST(request: Request) {
  const { imageBase64 } = await request.json();
  const result = await analyzeImage(imageBase64);
  return Response.json(result);
}

// app/api/listing-assistant/edit-image/route.ts
import { editImageWithAI } from '@/lib/listing-assistant/ai-service';

export async function POST(request: Request) {
  const { imageBase64, instruction } = await request.json();
  const editedImage = await editImageWithAI(imageBase64, instruction);
  return Response.json({ editedImage });
}

// app/api/listing-assistant/sold-prices/route.ts
import { getEbaySoldPrices } from '@/lib/listing-assistant/ebay-finding-service';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query') || '';
  const condition = (searchParams.get('condition') || 'Used') as 'New' | 'Used';
  
  const results = await getEbaySoldPrices(query, condition);
  return Response.json(results);
}
```

---

## Default Templates Content

```typescript
// lib/listing-assistant/constants.ts

export const DEFAULT_TEMPLATES: Omit<ListingTemplate, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [
  {
    name: 'Used Lego',
    type: 'lego_used',
    is_default: true,
    content: `<p><b>Set Number:</b> [Lookup]</p>
<p><b>Set Name:</b> [Lookup]</p>
<p><b>Year:</b> [Lookup]</p>
<p><b>Condition:</b> Used</p>
<p><b>Box:</b> [Yes/No/See Photos]</p>
<p><b>Instructions:</b> [Yes/No/Available Online]</p>
<br>
<p><b>Description:</b></p>
[Insert generated description based on key points]
<br>
<p>Items are shipped within 2 working days, often sooner.</p>
<p>Any questions with our listing please do not hesitate to contact us. We are adding new stock daily so take a look at our store for other new and used sets.</p>
<p>If you have any issues with purchased products please contact us so that we can resolve prior to providing us with feedback.</p>
<hr>
<p>Used Lego sets are checked for completeness prior to listing and listed as complete unless described in the listing - we build and inventory check all sets. However the manual nature of checking Lego means that a small number of pieces may be missing from all used Lego listings.</p>
<p>Used Lego may show signs of playwear, marks and slight discolouration, particularly with some of the vintage sets we sell. Refer to the condition description for anything explicitly called out. Broken or missing pieces are replaced as part of the sorting process.</p>
<p>Used Lego sets are sent dismantled unless otherwise stated. Please check listing carefully to see whether box and instructions are included - where instructions are not included we can provide a link to online instructions if available.</p>`
  },
  {
    name: 'New Lego',
    type: 'lego_new',
    is_default: true,
    content: `<p><b>Set Number:</b> [Lookup]</p>
<p><b>Set Name:</b> [Lookup]</p>
<p><b>Year:</b> [Lookup]</p>
<p><b>Retired:</b> [Lookup Yes/No]</p>
<p><b>Condition:</b> New</p>
<p><b>Box Condition:</b> Good - please refer to photos</p>
<br>
<p><b>Description:</b></p>
[Insert generated description based on key points]
<br>
<p>Items are shipped within 2 working days, often sooner.</p>
<p>Any questions with our listing please do not hesitate to contact us. We are adding new stock daily so take a look at our store for other new and used sets.</p>
<p>If you have any issues with purchased products please contact us so that we can resolve prior to providing us with feedback.</p>
<hr>
<p>Returns are only available if the box is returned in the same condition as sent, and is carefully sent back to us given the fragile nature of Lego boxes.</p>`
  },
  {
    name: 'Other Items',
    type: 'general',
    is_default: true,
    content: `<p><b>Brand:</b> [Lookup]</p>
<p><b>Model / Type:</b> [Lookup or Edit]</p>
<br>
<p><b>Description:</b></p>
[Insert generated description based on key points]
<br>
<p>Items are shipped within 2 working days, often sooner.</p>
<p>Any questions with our listing please do not hesitate to contact us. We are adding new stock daily so take a look at our store for other shoes / clothing.</p>
<p>If you have any issues with purchased products please contact us so that we can resolve prior to providing us with feedback.</p>
<hr>
<p>Returns are available within 30 days of purchase as long as the item is in the condition it was sold, for new items this includes any product packaging and labels that were sent as part of the sale - buyer to cover cost of return postage (unless there is an issue with the item).</p>`
  }
];
```

---

## Image Processing Service

```typescript
// lib/listing-assistant/image-processing.ts

export const DEFAULT_SETTINGS: ImageProcessSettings = {
  brightness: 1.1,
  contrast: 1.05,
  saturation: 1.0,
  sharpness: 0.5,
  padding: 0.1,
  temperature: 0
};

export async function processImage(
  imageSrc: string,
  settings: ImageProcessSettings
): Promise<string> {
  // 1. Load image
  const img = await loadImage(imageSrc);
  
  // 2. Create canvas and apply CSS filters
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  
  ctx.filter = `brightness(${settings.brightness}) contrast(${settings.contrast}) saturate(${settings.saturation})`;
  ctx.drawImage(img, 0, 0);
  ctx.filter = 'none';
  
  // 3. Apply temperature (manual RGB adjustment)
  if (settings.temperature !== 0) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.max(0, data[i] + settings.temperature));     // R
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] - settings.temperature)); // B
    }
    ctx.putImageData(imageData, 0, 0);
  }
  
  // 4. Apply sharpening (convolution kernel)
  if (settings.sharpness > 0) {
    applyConvolution(ctx, canvas.width, canvas.height, settings.sharpness);
  }
  
  // 5. Smart crop (detect bounding box of non-white pixels)
  const bbox = getBoundingBox(ctx, canvas.width, canvas.height);
  
  // 6. Create final square canvas with padding
  const maxDim = Math.max(bbox.w, bbox.h);
  const paddingPx = Math.round(maxDim * settings.padding);
  const finalSize = maxDim + (paddingPx * 2);
  
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = finalSize;
  finalCanvas.height = finalSize;
  const fCtx = finalCanvas.getContext('2d')!;
  
  // White background
  fCtx.fillStyle = '#FFFFFF';
  fCtx.fillRect(0, 0, finalSize, finalSize);
  
  // Center the cropped image
  const destX = (finalSize - bbox.w) / 2;
  const destY = (finalSize - bbox.h) / 2;
  fCtx.drawImage(canvas, bbox.x, bbox.y, bbox.w, bbox.h, destX, destY, bbox.w, bbox.h);
  
  return finalCanvas.toDataURL('image/jpeg', 0.95);
}
```

---

## Integration with Existing Hadley Bricks Features

### Inventory Connection (Primary Integration)

**"Push to eBay" Button Visibility Rules:**
```typescript
// Show button when:
item.listing_platform === 'ebay' && item.status === 'Backlog'
```

**Data Flow:**
1. User clicks "Push to eBay" on inventory item
2. Navigate to `/listing-assistant?inventoryId={id}`
3. Generator tab loads with pre-populated data
4. User generates listing, makes edits
5. Saves listing → linked back to inventory item
6. Optionally update inventory status to 'Listed'

**Inventory Fields to Map:**
| Inventory Field | Generator Field | Notes |
|-----------------|-----------------|-------|
| `name` / `title` | Item Name | Primary identifier |
| `condition` | Condition | Map to New/Used |
| `notes` | Key Points | Pre-fill with any notes |
| `category` | Template | Auto-select appropriate template |
| `set_number` | Item Name | Append to name for LEGO items |
| `images[0]` | Image | Load first image for analysis |

### eBay Finding API (Existing)

Leverage the existing Finding API integration:
- `findCompletedItems` for sold price research
- UK marketplace (EBAY-GB) as default
- Condition filtering (New=1000, Used=3000)

### Potential Future Enhancements

1. **Direct eBay Listing API:**
   - Push generated listing directly to eBay
   - Auto-populate eBay listing form
   - Track listing status in Hadley Bricks

2. **Order Tracking:**
   - When listing sells, auto-create order in system
   - Link sale price to inventory item for P&L

3. **Bulk Operations:**
   - Generate listings for multiple backlog items
   - Batch image processing

4. **Analytics:**
   - Compare estimated vs actual sale prices
   - Track listing conversion rates
   - API usage costs per listing

---

## Environment Variables

```env
# .env.local additions

# Claude Opus for text generation
ANTHROPIC_API_KEY=sk-ant-...

# Gemini for image analysis and editing
GOOGLE_AI_API_KEY=...

# eBay Finding API (existing - reuse from Hadley Bricks config)
EBAY_APP_ID=...  # Client ID from eBay Developer Portal
```

---

## Migration Notes

### From Original App

1. **Storage Migration:**
   - Original uses `localStorage` for templates, listings, settings
   - New implementation uses Supabase for persistence
   - Provide import functionality for existing localStorage data

2. **API Migration:**
   - Original uses Gemini (`@google/genai`)
   - Can switch to Claude or keep Gemini
   - Image editing (`gemini-2.5-flash-image`) has no direct Claude equivalent

3. **Styling:**
   - Original uses Tailwind CSS
   - Hadley Bricks likely uses similar - verify design system
   - Adapt color scheme (indigo → your primary color)

---

## Testing Checklist

- [ ] Template CRUD operations
- [ ] Listing generation with Claude Opus
- [ ] Image analysis with Gemini
- [ ] Image editing with Gemini (defect removal)
- [ ] eBay Finding API price lookup
- [ ] Image upload and preview
- [ ] Image processing (all adjustments)
- [ ] HTML editor functionality
- [ ] Copy to clipboard
- [ ] Save to history with inventory link
- [ ] "Push to eBay" button on inventory items
- [ ] Pre-population from inventory data
- [ ] Settings persistence
- [ ] Responsive layout
- [ ] Error handling and loading states
- [ ] Empty states

---

## Implementation Priority

### Phase 1: Core Infrastructure
1. Database schema and migrations
2. ListingAssistantPage with tab navigation
3. Basic routing `/listing-assistant`
4. TypeScript types

### Phase 2: Generator Tab (MVP)
1. GeneratorTab UI (form + output)
2. TemplatesTab with RichTextEditor
3. HistoryTab for saved listings
4. Claude Opus integration for text generation
5. eBay Finding API integration for prices

### Phase 3: Inventory Integration
1. "Push to eBay" button component
2. Route with `?inventoryId=` parameter
3. Pre-population logic from inventory
4. Linking generated listings back to inventory

### Phase 4: Image Studio
1. Image upload and gallery
2. Client-side image processing (canvas)
3. Gemini image analysis integration
4. Gemini image editing ("Fix with AI")
5. Export functionality (download, save all)

### Phase 5: Polish & Enhancement
1. Mobile responsiveness
2. Bulk operations (multiple items)
3. Analytics integration
4. Direct eBay listing API (future)
