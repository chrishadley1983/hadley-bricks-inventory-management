/**
 * Listing Assistant Constants
 *
 * Default templates, settings, and configuration values
 * for the eBay Listing Assistant feature.
 */

import type { ImageProcessSettings, ListingTone, TemplateType, CreateTemplateInput } from './types';

// ============================================
// eBay Image Standards
// ============================================

export const EBAY_IMAGE_SPECS = {
  /** Maximum number of photos per listing */
  maxPhotos: 24,
  /** Minimum dimension in pixels */
  minDimension: 500,
  /** Recommended dimension for zoom feature */
  recommendedDimension: 1600,
  /** Maximum file size in bytes (12MB) */
  maxFileSizeBytes: 12 * 1024 * 1024,
  /** Maximum file size in MB for display */
  maxFileSizeMB: 12,
  /** Supported formats */
  supportedFormats: ['image/jpeg', 'image/png', 'image/webp'],
} as const;

// ============================================
// Default Image Processing Settings
// ============================================

export const DEFAULT_IMAGE_SETTINGS: ImageProcessSettings = {
  brightness: 1.1,
  contrast: 1.05,
  saturation: 1.0,
  sharpness: 0.5,
  padding: 0.1,
  temperature: 0,
};

// ============================================
// Tone Options
// ============================================

export const LISTING_TONES: { value: ListingTone; label: string; description: string }[] = [
  {
    value: 'Minimalist',
    label: 'Minimalist',
    description: 'Clean, concise, just the facts',
  },
  {
    value: 'Standard',
    label: 'Standard',
    description: 'Balanced, informative, professional',
  },
  {
    value: 'Professional',
    label: 'Professional',
    description: 'Formal, detailed, business-like',
  },
  {
    value: 'Friendly',
    label: 'Friendly',
    description: 'Warm, approachable, conversational',
  },
  {
    value: 'Enthusiastic',
    label: 'Enthusiastic',
    description: 'Energetic, exciting, persuasive',
  },
];

// ============================================
// Template Types
// ============================================

export const TEMPLATE_TYPES: { value: TemplateType; label: string }[] = [
  { value: 'lego_used', label: 'Used LEGO' },
  { value: 'lego_new', label: 'New LEGO' },
  { value: 'general', label: 'General' },
  { value: 'custom', label: 'Custom' },
];

// ============================================
// Default Templates
// ============================================

export const DEFAULT_TEMPLATES: CreateTemplateInput[] = [
  {
    name: 'Used LEGO',
    type: 'lego_used',
    is_default: true,
    content: `<p><b>Set Number:</b> [Set Number]</p>
<p><b>Set Name:</b> [Set Name]</p>
<p><b>Year:</b> [Year]</p>
<p><b>Condition:</b> Used</p>
<p><b>Box:</b> [Yes/No/See Photos]</p>
<p><b>Instructions:</b> [Yes/No/Available Online]</p>
<br>
<p><b>Description:</b></p>
<p>[Insert generated description based on key points]</p>
<br>
<p>Items are shipped within 2 working days, often sooner.</p>
<p>Any questions with our listing please do not hesitate to contact us. We are adding new stock daily so take a look at our store for other new and used sets.</p>
<p>If you have any issues with purchased products please contact us so that we can resolve prior to providing us with feedback.</p>
<hr>
<p>Used Lego sets are checked for completeness prior to listing and listed as complete unless described in the listing - we build and inventory check all sets. However the manual nature of checking Lego means that a small number of pieces may be missing from all used Lego listings.</p>
<p>Used Lego may show signs of playwear, marks and slight discolouration, particularly with some of the vintage sets we sell. Refer to the condition description for anything explicitly called out. Broken or missing pieces are replaced as part of the sorting process.</p>
<p>Used Lego sets are sent dismantled unless otherwise stated. Please check listing carefully to see whether box and instructions are included - where instructions are not included we can provide a link to online instructions if available.</p>`,
  },
  {
    name: 'New LEGO',
    type: 'lego_new',
    is_default: true,
    content: `<p><b>Set Number:</b> [Set Number]</p>
<p><b>Set Name:</b> [Set Name]</p>
<p><b>Year:</b> [Year]</p>
<p><b>Retired:</b> [Yes/No]</p>
<p><b>Condition:</b> New</p>
<p><b>Box Condition:</b> Good - please refer to photos</p>
<br>
<p><b>Description:</b></p>
<p>[Insert generated description based on key points]</p>
<br>
<p>Items are shipped within 2 working days, often sooner.</p>
<p>Any questions with our listing please do not hesitate to contact us. We are adding new stock daily so take a look at our store for other new and used sets.</p>
<p>If you have any issues with purchased products please contact us so that we can resolve prior to providing us with feedback.</p>
<hr>
<p>Returns are only available if the box is returned in the same condition as sent, and is carefully sent back to us given the fragile nature of Lego boxes.</p>`,
  },
  {
    name: 'Other Items',
    type: 'general',
    is_default: true,
    content: `<p><b>Brand:</b> [Brand]</p>
<p><b>Model / Type:</b> [Model or Type]</p>
<br>
<p><b>Description:</b></p>
<p>[Insert generated description based on key points]</p>
<br>
<p>Items are shipped within 2 working days, often sooner.</p>
<p>Any questions with our listing please do not hesitate to contact us. We are adding new stock daily so take a look at our store for other items.</p>
<p>If you have any issues with purchased products please contact us so that we can resolve prior to providing us with feedback.</p>
<hr>
<p>Returns are available within 30 days of purchase as long as the item is in the condition it was sold, for new items this includes any product packaging and labels that were sent as part of the sale - buyer to cover cost of return postage (unless there is an issue with the item).</p>`,
  },
];

// ============================================
// Image Processing Presets
// ============================================

export const IMAGE_PRESETS = {
  reset: { ...DEFAULT_IMAGE_SETTINGS },
  highContrast: {
    ...DEFAULT_IMAGE_SETTINGS,
    brightness: 1.15,
    contrast: 1.25,
    saturation: 1.1,
  },
  bright: {
    ...DEFAULT_IMAGE_SETTINGS,
    brightness: 1.3,
  },
  warm: {
    ...DEFAULT_IMAGE_SETTINGS,
    temperature: 25,
  },
  cool: {
    ...DEFAULT_IMAGE_SETTINGS,
    temperature: -25,
  },
};

// ============================================
// eBay Optimization Settings
// ============================================

/**
 * Target settings for "Optimise for eBay" one-click action.
 * Based on eBay 2026 mobile SEO best practices.
 *
 * Features:
 * - 1:1 square crop with product centered
 * - Product occupies ~85% of canvas (10-15% padding)
 * - Brightness +15% (dynamic based on image)
 * - Contrast +10% for depth
 * - Sharpness 0.65-0.70 for legible text
 * - Temperature neutral (cool to counteract indoor warm lighting)
 * - Background whitening with shadow preservation
 */
export const EBAY_OPTIMIZE_SETTINGS: ImageProcessSettings = {
  brightness: 1.15,      // +15% exposure boost
  contrast: 1.10,        // +10% contrast for depth
  saturation: 1.0,       // Keep natural
  sharpness: 0.65,       // High-pass for legible text
  padding: 0.12,         // 10-15% breathing room
  temperature: -15,      // Cool to neutralize indoor warmth
};

// ============================================
// Slider Configurations
// ============================================

export const SLIDER_CONFIG = {
  brightness: { min: 0.5, max: 2.0, step: 0.05, default: 1.1 },
  contrast: { min: 0.5, max: 2.0, step: 0.05, default: 1.05 },
  saturation: { min: 0.5, max: 2.0, step: 0.05, default: 1.0 },
  sharpness: { min: 0, max: 1, step: 0.05, default: 0.5 },
  padding: { min: 0.05, max: 0.3, step: 0.01, default: 0.1 },
  temperature: { min: -50, max: 50, step: 1, default: 0 },
};

// ============================================
// Status Badge Colors
// ============================================

export const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  ready: 'bg-blue-100 text-blue-800',
  listed: 'bg-green-100 text-green-800',
  sold: 'bg-purple-100 text-purple-800',
};

// ============================================
// Condition Badge Colors
// ============================================

export const CONDITION_COLORS: Record<string, string> = {
  New: 'bg-emerald-100 text-emerald-800',
  Used: 'bg-amber-100 text-amber-800',
};
