# eBay Listing Assistant - Implementation Plan

## Overview

This plan outlines the phased implementation of the eBay Listing Assistant feature, a new sidebar page with 4 tabs (Create Listing, Image Studio, Templates, History) that integrates with the existing inventory system and eBay Finding API.

**Branch:** `feature/listing-assistant`
**Route:** `/listing-assistant`
**Specification:** [docs/ebay-listing-assistant-spec.md](../ebay-listing-assistant-spec.md)

---

## Phase 1: Database Schema & Core Infrastructure

### 1.1 Database Migration

Create migration file: `supabase/migrations/20260114000001_listing_assistant.sql`

**Tables to create:**

```sql
-- listing_templates: Store HTML templates for eBay listings
CREATE TABLE listing_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'custom',  -- lego_used, lego_new, general, custom
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- generated_listings: Store AI-generated listings with inventory links
CREATE TABLE generated_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  item_name VARCHAR(255) NOT NULL,
  condition VARCHAR(10) NOT NULL,
  title VARCHAR(255) NOT NULL,
  price_range VARCHAR(50),
  description TEXT NOT NULL,
  template_id UUID REFERENCES listing_templates(id) ON DELETE SET NULL,
  source_urls TEXT[],
  ebay_sold_data JSONB,
  status VARCHAR(20) DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- listing_assistant_settings: User preferences
CREATE TABLE listing_assistant_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  default_tone VARCHAR(20) DEFAULT 'Minimalist',
  default_condition VARCHAR(10) DEFAULT 'Used',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**RLS Policies:**
- Users can only access their own templates, listings, and settings
- Standard policy pattern: `auth.uid() = user_id`

**Indexes:**
- `idx_generated_listings_inventory` on `inventory_item_id`
- `idx_generated_listings_status` on `status`
- `idx_generated_listings_user_created` on `(user_id, created_at DESC)`

### 1.2 TypeScript Types

Create: `apps/web/src/lib/listing-assistant/types.ts`

```typescript
// Core types
export interface ListingTemplate { ... }
export interface GeneratedListing { ... }
export interface ListingAssistantSettings { ... }

// Form/generation types
export type ListingTone = 'Standard' | 'Professional' | 'Enthusiastic' | 'Friendly' | 'Minimalist';
export type ListingStatus = 'draft' | 'ready' | 'listed' | 'sold';
export interface ListingFormData { ... }
export interface GenerationResult { ... }

// Image Studio types
export interface ImageProcessSettings { ... }
export interface ImageAnalysisResult { ... }
export interface StudioImage { ... }

// eBay sold data types (reuse from existing)
export interface EbaySoldItem { ... }
```

### 1.3 Regenerate Database Types

Run: `npm run db:types` after migration is applied

---

## Phase 2: Core UI Structure

### 2.1 Page Setup

Create: `apps/web/src/app/(dashboard)/listing-assistant/page.tsx`

```typescript
'use client';

import dynamic from 'next/dynamic';
import { HeaderSkeleton } from '@/components/ui/skeletons';
import { Suspense } from 'react';

const Header = dynamic(
  () => import('@/components/layout/Header').then((m) => ({ default: m.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

const ListingAssistantTabs = dynamic(
  () => import('@/components/features/listing-assistant').then((m) => ({
    default: m.ListingAssistantTabs
  })),
  { ssr: false, loading: () => <TabsLoadingSkeleton /> }
);

export default function ListingAssistantPage() {
  return (
    <>
      <Header title="Listing Assistant" />
      <div className="p-6">
        <Suspense fallback={<TabsLoadingSkeleton />}>
          <ListingAssistantTabs />
        </Suspense>
      </div>
    </>
  );
}
```

### 2.2 Tab Container Component

Create: `apps/web/src/components/features/listing-assistant/ListingAssistantTabs.tsx`

Pattern: Follow `InventoryAddTabs.tsx` structure
- 4 tabs: Create Listing, Image Studio, Templates, History
- Lazy load tab content with `React.lazy()` + `Suspense`
- Support `?inventoryId=` query param for pre-population
- Badge on History tab showing listing count

### 2.3 Sidebar Navigation

Update: `apps/web/src/components/layout/Sidebar.tsx`

Add to `mainNavItems` array (after Purchase Evaluator):
```typescript
{ href: '/listing-assistant', label: 'Listing Assistant', icon: Edit },
```

Import `Edit` from `lucide-react`.

### 2.4 Loading States

Create: `apps/web/src/app/(dashboard)/listing-assistant/loading.tsx`

Use `TabsLoadingSkeleton` component with 4 tab placeholders.

---

## Phase 3: Templates Tab (Foundation)

### 3.1 Templates CRUD API

Create API routes:
- `apps/web/src/app/api/listing-assistant/templates/route.ts` (GET all, POST create)
- `apps/web/src/app/api/listing-assistant/templates/[id]/route.ts` (GET, PATCH, DELETE)

Validation schemas with Zod:
```typescript
const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  type: z.enum(['lego_used', 'lego_new', 'general', 'custom']),
  is_default: z.boolean().optional(),
});
```

### 3.2 Templates Service

Create: `apps/web/src/lib/listing-assistant/templates.service.ts`

Methods:
- `getTemplates(userId)`
- `getTemplateById(userId, id)`
- `createTemplate(userId, data)`
- `updateTemplate(userId, id, data)`
- `deleteTemplate(userId, id)` - only custom templates
- `seedDefaultTemplates(userId)` - create defaults on first use

### 3.3 Templates Hooks

Create: `apps/web/src/hooks/listing-assistant/use-templates.ts`

```typescript
export const templateKeys = { ... };
export function useTemplates() { ... }
export function useTemplate(id: string) { ... }
export function useCreateTemplate() { ... }
export function useUpdateTemplate() { ... }
export function useDeleteTemplate() { ... }
```

### 3.4 Templates Tab UI

Create: `apps/web/src/components/features/listing-assistant/tabs/TemplatesTab.tsx`

Features:
- Grid of template cards
- Preview HTML content (truncated)
- Edit/Delete buttons (delete only for custom)
- "Create New Template" button
- Modal editor with name input + RichTextEditor

### 3.5 RichTextEditor Component

Create: `apps/web/src/components/features/listing-assistant/shared/RichTextEditor.tsx`

Options:
1. **Simple:** Use `contentEditable` div with `document.execCommand`
2. **Recommended:** Use Tiptap or react-quill for better control

Toolbar buttons: Bold, Italic, Underline, H2, H3, P, Lists, Clear Formatting

### 3.6 Default Templates Content

Create: `apps/web/src/lib/listing-assistant/constants.ts`

Include the 3 default templates from spec:
- Used LEGO
- New LEGO
- Other Items

---

## Phase 4: Generator Tab (Core Feature)

### 4.1 Listing Generation API

Create: `apps/web/src/app/api/listing-assistant/generate/route.ts`

Flow:
1. Validate input (item, condition, keyPoints, templateId, tone, imageBase64?)
2. Fetch template content
3. Call eBay Finding API for sold prices
4. If image provided, analyze with Gemini
5. Generate listing with Claude Opus
6. Return result with eBay sold data

### 4.2 AI Service Layer

Create: `apps/web/src/lib/listing-assistant/ai-service.ts`

**Claude Opus - Text Generation:**
```typescript
export async function generateListing(
  item: string,
  condition: string,
  keyPoints: string,
  templateContent: string,
  tone: string,
  ebaySoldData?: EbaySoldItem[],
  imageAnalysis?: ImageAnalysisResult
): Promise<GenerationResult>
```

Uses existing `ClaudeClient` from `@/lib/ai/claude-client.ts`
- Model: `claude-opus-4-20250514`
- Temperature: 0.3 for structured output
- System prompt for eBay listing expert
- Return JSON: title, priceRange, description

### 4.3 eBay Finding API Integration

Create: `apps/web/src/lib/listing-assistant/ebay-finding.service.ts`

Reuse existing `getEbayFindingClient()` from `@/lib/ebay/ebay-finding.client.ts`:
```typescript
export async function getEbaySoldPrices(
  query: string,
  condition: 'New' | 'Used'
): Promise<EbaySoldItem[]>
```

### 4.4 Gemini Image Analysis (for Generator)

Extend: `apps/web/src/lib/ai/gemini-client.ts`

Add new function:
```typescript
export async function analyzeProductImageForListing(
  image: GeminiImageInput
): Promise<ImageAnalysisResult>
```

Returns: altText, defectsNote, suggestedFilename

### 4.5 Generator Hooks

Create: `apps/web/src/hooks/listing-assistant/use-generator.ts`

```typescript
export function useGenerateListing() {
  return useMutation({
    mutationFn: async (data: ListingFormData) => {
      const response = await fetch('/api/listing-assistant/generate', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return response.json();
    }
  });
}
```

### 4.6 Generator Tab UI

Create: `apps/web/src/components/features/listing-assistant/tabs/GeneratorTab.tsx`

**Input Section:**
- Item name input
- Image upload with preview (optional)
- Template selector dropdown
- Condition toggle (New/Used)
- Tone selector dropdown
- Key points textarea
- Generate button with loading state

**Output Section (after generation):**
- Editable title input
- Price range badge
- RichTextEditor for description
- Toggle for HTML source view
- Copy HTML button
- Save to History button
- eBay sold items display (collapsible)

### 4.7 Generator Sub-components

Create in `apps/web/src/components/features/listing-assistant/generator/`:
- `ItemDetailsForm.tsx` - The input form
- `GeneratedOutput.tsx` - Result display and editing
- `ImageUpload.tsx` - Drag & drop image upload
- `EbaySoldItemsDisplay.tsx` - Show comparable sales

---

## Phase 5: History Tab

### 5.1 Listings CRUD API

Create:
- `apps/web/src/app/api/listing-assistant/listings/route.ts` (GET all, POST save)
- `apps/web/src/app/api/listing-assistant/listings/[id]/route.ts` (GET, PATCH, DELETE)

### 5.2 Listings Service

Create: `apps/web/src/lib/listing-assistant/listings.service.ts`

Methods:
- `getListings(userId, filters?)` - with pagination
- `getListingById(userId, id)`
- `saveListing(userId, data)` - from generated result
- `updateListing(userId, id, data)`
- `deleteListing(userId, id)`

### 5.3 Listings Hooks

Create: `apps/web/src/hooks/listing-assistant/use-listings.ts`

### 5.4 History Tab UI

Create: `apps/web/src/components/features/listing-assistant/tabs/HistoryTab.tsx`

Features:
- List of saved listings (cards)
- Each card shows: title, date, price range, condition badge
- HTML preview (rendered)
- Copy HTML button
- Delete button
- Empty state when no listings
- Link to source inventory item if available

---

## Phase 6: Inventory Integration

### 6.1 "Push to eBay" Button

Create: `apps/web/src/components/features/inventory/PushToEbayButton.tsx`

```typescript
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
    router.push(`/listing-assistant?inventoryId=${item.id}`);
  };

  return (
    <Button onClick={handlePush} variant="secondary" size="sm">
      <Upload className="w-4 h-4 mr-2" />
      Create Listing
    </Button>
  );
}
```

### 6.2 Integrate Button into Inventory

Update inventory item views to include the button:
- `apps/web/src/components/features/inventory/InventoryItemActions.tsx` (or similar)
- Show in row actions menu or detail panel

### 6.3 Pre-population from Inventory

In `GeneratorTab.tsx`:
- Read `inventoryId` from URL search params
- Fetch inventory item data
- Pre-populate form fields:
  - Item Name ← `item_name` (+ `set_number` if LEGO)
  - Condition ← `condition`
  - Key Points ← `notes`
  - Template ← auto-select based on category
  - Image ← first from `images` array if available

### 6.4 Link Listings to Inventory

When saving a generated listing:
- Store `inventory_item_id` in `generated_listings` table
- Optionally update inventory item status
- Show link back to inventory in History tab

---

## Phase 7: Image Studio Tab

### 7.1 Image Processing Service

Create: `apps/web/src/lib/listing-assistant/image-processing.ts`

Client-side canvas-based processing:
- Brightness/contrast via CSS filters
- Temperature via RGB channel adjustment
- Sharpening via convolution kernel
- Smart crop (detect bounding box of non-white pixels)
- Square composition with white background
- JPEG output at 95% quality

```typescript
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
): Promise<string>
```

### 7.2 Image Studio API Routes

Create:
- `apps/web/src/app/api/listing-assistant/analyze-image/route.ts` - Gemini analysis
- `apps/web/src/app/api/listing-assistant/edit-image/route.ts` - Gemini AI editing

### 7.3 Gemini Image Editing

Extend: `apps/web/src/lib/ai/gemini-client.ts`

Add AI image editing (defect removal):
```typescript
export async function editImageWithAI(
  image: GeminiImageInput,
  instruction: string
): Promise<string>
```

Note: This requires `gemini-2.5-flash` model which may have different capabilities. May need to use `@google/genai` with image generation config.

### 7.4 Image Studio Hooks

Create: `apps/web/src/hooks/listing-assistant/use-image-processor.ts`

```typescript
export function useImageProcessor() {
  const [images, setImages] = useState<StudioImage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const addImages = (files: File[]) => { ... };
  const processImage = (id: string, settings: ImageProcessSettings) => { ... };
  const analyzeImage = (id: string) => { ... };  // Gemini
  const fixWithAI = (id: string) => { ... };  // Gemini
  const downloadImage = (id: string) => { ... };
  const downloadAll = () => { ... };

  return { images, selectedId, setSelectedId, ... };
}
```

### 7.5 Image Studio Tab UI

Create: `apps/web/src/components/features/listing-assistant/tabs/ImageStudioTab.tsx`

**Layout:**
- Left: Thumbnail gallery
- Center: Main preview (1:1 square)
- Right: Controls panel

**Controls:**
- Sliders: Brightness, Contrast, Sharpness, Padding, Temperature
- Quick buttons: Brighter+, Darker-, Zoom In/Out, Warmer, Cooler, High Contrast, Reset
- AI panel: Alt text, Defect notes, Fix with AI button

### 7.6 Image Studio Sub-components

Create in `apps/web/src/components/features/listing-assistant/image-studio/`:
- `ImageGallery.tsx` - Thumbnail strip
- `ImagePreview.tsx` - Main preview area
- `EditControls.tsx` - Sliders and buttons
- `AIAnalysisPanel.tsx` - Gemini insights display

---

## Phase 8: Settings & Polish

### 8.1 Settings API

Create: `apps/web/src/app/api/listing-assistant/settings/route.ts`

GET and PATCH for user settings.

### 8.2 Settings Hook

Create: `apps/web/src/hooks/listing-assistant/use-settings.ts`

### 8.3 Settings Modal

Create: `apps/web/src/components/features/listing-assistant/shared/SettingsModal.tsx`

Options:
- Default tone
- Default condition

### 8.4 Mobile Responsiveness

Ensure all tabs work on mobile (375px, 768px breakpoints):
- Stack controls vertically on mobile
- Responsive image gallery
- Touch-friendly sliders

### 8.5 Error Handling

Implement consistent error handling:
- API errors with user-friendly messages
- Retry logic for AI API calls
- Loading states throughout

### 8.6 Empty States

Create appropriate empty states for:
- No templates (show default seeding CTA)
- No history
- No image selected in studio

---

## File Structure Summary

```
apps/web/src/
├── app/
│   ├── (dashboard)/
│   │   └── listing-assistant/
│   │       ├── page.tsx
│   │       └── loading.tsx
│   └── api/
│       └── listing-assistant/
│           ├── generate/route.ts
│           ├── templates/
│           │   ├── route.ts
│           │   └── [id]/route.ts
│           ├── listings/
│           │   ├── route.ts
│           │   └── [id]/route.ts
│           ├── settings/route.ts
│           ├── analyze-image/route.ts
│           └── edit-image/route.ts
├── components/
│   ├── features/
│   │   ├── listing-assistant/
│   │   │   ├── index.ts
│   │   │   ├── ListingAssistantTabs.tsx
│   │   │   ├── tabs/
│   │   │   │   ├── GeneratorTab.tsx
│   │   │   │   ├── ImageStudioTab.tsx
│   │   │   │   ├── TemplatesTab.tsx
│   │   │   │   └── HistoryTab.tsx
│   │   │   ├── generator/
│   │   │   │   ├── ItemDetailsForm.tsx
│   │   │   │   ├── GeneratedOutput.tsx
│   │   │   │   ├── ImageUpload.tsx
│   │   │   │   └── EbaySoldItemsDisplay.tsx
│   │   │   ├── image-studio/
│   │   │   │   ├── ImageGallery.tsx
│   │   │   │   ├── ImagePreview.tsx
│   │   │   │   ├── EditControls.tsx
│   │   │   │   └── AIAnalysisPanel.tsx
│   │   │   ├── templates/
│   │   │   │   ├── TemplateList.tsx
│   │   │   │   └── TemplateEditor.tsx
│   │   │   ├── history/
│   │   │   │   └── ListingCard.tsx
│   │   │   └── shared/
│   │   │       ├── RichTextEditor.tsx
│   │   │       └── SettingsModal.tsx
│   │   └── inventory/
│   │       └── PushToEbayButton.tsx  (new)
│   └── layout/
│       └── Sidebar.tsx  (update)
├── hooks/
│   └── listing-assistant/
│       ├── use-templates.ts
│       ├── use-listings.ts
│       ├── use-generator.ts
│       ├── use-image-processor.ts
│       └── use-settings.ts
└── lib/
    └── listing-assistant/
        ├── types.ts
        ├── constants.ts
        ├── ai-service.ts
        ├── ebay-finding.service.ts
        ├── templates.service.ts
        ├── listings.service.ts
        └── image-processing.ts
```

---

## Implementation Order

### MVP (Phases 1-5)
1. **Phase 1:** Database schema + types
2. **Phase 2:** Core UI structure + tabs + sidebar
3. **Phase 3:** Templates tab (foundation for generator)
4. **Phase 4:** Generator tab (core AI feature)
5. **Phase 5:** History tab

### Full Feature (Phases 6-8)
6. **Phase 6:** Inventory integration
7. **Phase 7:** Image Studio tab
8. **Phase 8:** Settings & polish

---

## Testing Checklist

- [ ] Template CRUD operations
- [ ] Listing generation with Claude Opus
- [ ] eBay Finding API price lookup integration
- [ ] Image analysis with Gemini
- [ ] Image editing with Gemini (defect removal)
- [ ] Image upload and preview
- [ ] Client-side image processing (all adjustments)
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

## Dependencies

**Existing (reuse):**
- `@/lib/ai/claude-client.ts` - Claude API
- `@/lib/ai/gemini-client.ts` - Gemini API (extend)
- `@/lib/ebay/ebay-finding.client.ts` - eBay Finding API

**New packages (if needed):**
- `react-quill` or `@tiptap/react` - Rich text editor (optional, can use contentEditable)

---

## Environment Variables

Already configured:
- `ANTHROPIC_API_KEY` - Claude Opus
- `GOOGLE_AI_API_KEY` - Gemini 2.5 Flash
- `EBAY_APP_ID` / `EBAY_CLIENT_ID` - eBay Finding API

No new environment variables needed.