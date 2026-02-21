/**
 * Listing Assistant Types
 *
 * Core types for the eBay Listing Assistant feature including
 * templates, generated listings, settings, and image processing.
 */

// ============================================
// Template Types
// ============================================

export type TemplateType = 'lego_used' | 'lego_new' | 'general' | 'custom';

export interface ListingTemplate {
  id: string;
  user_id: string;
  name: string;
  content: string; // HTML content
  type: TemplateType;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateInput {
  name: string;
  content: string;
  type: TemplateType;
  is_default?: boolean;
}

export interface UpdateTemplateInput {
  name?: string;
  content?: string;
  type?: TemplateType;
  is_default?: boolean;
}

// ============================================
// Generated Listing Types
// ============================================

export type ListingStatus = 'draft' | 'ready' | 'listed' | 'sold';
export type ListingCondition = 'New' | 'Used';

export interface GeneratedListing {
  id: string;
  user_id: string;
  inventory_item_id: string | null;
  item_name: string;
  condition: ListingCondition;
  title: string;
  price_range: string | null;
  description: string; // HTML content
  template_id: string | null;
  source_urls: string[] | null;
  ebay_sold_data: EbaySoldItem[] | null;
  status: ListingStatus;
  created_at: string;
}

export interface CreateListingInput {
  inventory_item_id?: string | null;
  item_name: string;
  condition: ListingCondition;
  title: string;
  price_range?: string | null;
  description: string;
  template_id?: string | null;
  source_urls?: string[] | null;
  ebay_sold_data?: EbaySoldItem[] | null;
  status?: ListingStatus;
}

export interface UpdateListingInput {
  title?: string;
  price_range?: string | null;
  description?: string;
  status?: ListingStatus;
}

// ============================================
// Settings Types
// ============================================

export type ListingTone = 'Standard' | 'Professional' | 'Enthusiastic' | 'Friendly' | 'Minimalist';

export interface ListingAssistantSettings {
  id: string;
  user_id: string;
  default_tone: ListingTone;
  default_condition: ListingCondition;
  created_at: string;
  updated_at: string;
}

export interface UpdateSettingsInput {
  default_tone?: ListingTone;
  default_condition?: ListingCondition;
}

// ============================================
// Form & Generation Types
// ============================================

export interface ListingFormData {
  item: string;
  templateId: string;
  condition: ListingCondition;
  keyPoints: string;
  tone: ListingTone;
  imageBase64?: string;
  inventoryItemId?: string;
}

export interface GenerationResult {
  title: string;
  priceRange: string;
  description: string;
  groundingUrls?: string[];
  ebaySoldItems?: EbaySoldItem[];
}

// ============================================
// eBay Sold Data Types
// ============================================

export interface EbaySoldItem {
  itemId: string;
  title: string;
  soldPrice: number;
  currency: string;
  soldDate: string;
  condition: string;
  url: string;
  imageUrl?: string;
}

export interface EbaySoldPriceResult {
  minPrice: number | null;
  avgPrice: number | null;
  maxPrice: number | null;
  soldCount: number;
  items: EbaySoldItem[];
}

// ============================================
// Image Studio Types
// ============================================

export interface ImageProcessSettings {
  brightness: number; // 0.5 to 2.0, default 1.1
  contrast: number; // 0.5 to 2.0, default 1.05
  saturation: number; // 0.5 to 2.0, default 1.0
  sharpness: number; // 0 to 1, default 0.5
  padding: number; // 0.05 to 0.3, default 0.1
  temperature: number; // -50 to 50, default 0
}

export interface ImageAnalysisResult {
  altText: string;
  defectsNote: string | null;
  suggestedFilename: string;
}

export interface StudioImage {
  id: string;
  name: string;
  fileName: string;
  original: string; // base64 data URL
  processed: string | null;
  settings: ImageProcessSettings;
  analysis: ImageAnalysisResult | null;
  isProcessing: boolean;
  isAnalyzing: boolean;
  isFixing: boolean;
}

// ============================================
// Inventory Integration Types
// ============================================

export interface InventoryItemForListing {
  id: string;
  item_name: string;
  set_number: string | null;
  condition: string;
  notes: string | null;
  category: string | null;
  listing_platform: string | null;
  status: string;
}

// ============================================
// API Response Types
// ============================================

export interface GenerateListingRequest {
  item: string;
  condition: ListingCondition;
  keyPoints: string;
  templateId: string;
  tone: ListingTone;
  imageBase64?: string;
  inventoryItemId?: string;
}

export interface GenerateListingResponse {
  title: string;
  priceRange: string;
  description: string;
  ebaySoldItems: EbaySoldItem[];
  imageAnalysis?: ImageAnalysisResult;
}

export interface AnalyzeImageRequest {
  imageBase64: string;
}

export interface AnalyzeImageResponse {
  altText: string;
  defectsNote: string | null;
  suggestedFilename: string;
}

export interface EditImageRequest {
  imageBase64: string;
  instruction: string;
}

export interface EditImageResponse {
  editedImage: string; // base64 data URL
}
