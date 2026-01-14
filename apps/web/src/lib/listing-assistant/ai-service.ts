/**
 * AI Service for Listing Assistant
 *
 * Handles AI-powered listing generation using Claude Opus
 * and image analysis using Gemini.
 */

import { sendMessageForJSON } from '@/lib/ai/claude-client';
import { analyzeImagesWithGemini, type GeminiImageInput } from '@/lib/ai/gemini-client';
import type {
  GenerationResult,
  EbaySoldItem,
  ImageAnalysisResult,
  ListingTone,
  ListingCondition,
} from './types';

// ============================================
// Listing Generation (Claude Opus)
// ============================================

/**
 * Generate an eBay listing using Claude Opus
 */
export async function generateListing(
  item: string,
  condition: ListingCondition,
  keyPoints: string,
  templateContent: string,
  tone: ListingTone,
  ebaySoldData?: EbaySoldItem[],
  imageAnalysis?: ImageAnalysisResult
): Promise<GenerationResult> {
  const systemPrompt = `You are an expert eBay seller assistant for Hadley Bricks, a LEGO resale business based in the UK.

Your goal is to create compelling eBay listings that sell quickly at good prices.

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
   - Use power words that drive clicks (e.g., "LEGO", set number, key features)
   - Do NOT use all caps or excessive punctuation

2. Estimate a fair market price range in GBP (£)
   - Use the provided eBay sold data as primary reference
   - Consider condition when comparing to sold items
   - Provide realistic range (e.g., "£45 - £55")
   - If no sold data available, provide best estimate based on item type

3. Fill out the provided HTML Template
   - PRESERVE all HTML structure (tags like <p>, <b>, <br>, <h3>, <hr>)
   - Replace placeholders like [Set Number], [Set Name], [Year] with actual data
   - If you don't have certain information, use reasonable placeholders or remove the line
   - Use image analysis details if provided
   - Write compelling description using Key Points
   - Adopt the requested tone: "${tone}"
   - Keep boilerplate shipping/returns text intact

TONE GUIDE:
- Minimalist: Clean, concise, just the facts. No fluff.
- Standard: Balanced, informative, professional.
- Professional: Formal, detailed, business-like.
- Friendly: Warm, approachable, conversational.
- Enthusiastic: Energetic, exciting, persuasive.

CRITICAL: Return ONLY valid JSON. No markdown, no code blocks.

Output Schema:
{
  "title": "eBay Listing Title",
  "priceRange": "£XX - £YY",
  "description": "Full HTML template with all fields populated"
}`;

  const ebaySoldText = ebaySoldData?.length
    ? ebaySoldData
        .slice(0, 5)
        .map(
          (s) =>
            `- ${s.title}: £${s.soldPrice.toFixed(2)} (${s.soldDate}, ${s.condition})`
        )
        .join('\n')
    : 'No recent sales data available';

  const imageAnalysisText = imageAnalysis
    ? `Alt Text: ${imageAnalysis.altText}\nNotes: ${imageAnalysis.defectsNote || 'None detected'}`
    : 'No image provided';

  const userPrompt = `**Item:** ${item}
**Condition:** ${condition}
**Tone:** ${tone}
**Key Points:** ${keyPoints || 'None provided'}

**Recent eBay Sold Prices (UK):**
${ebaySoldText}

**Image Analysis:**
${imageAnalysisText}

**Template to Fill (HTML):**
"""
${templateContent}
"""

Please generate the eBay listing now.`;

  console.log('[AI Service] Generating listing with Claude Opus...');

  const result = await sendMessageForJSON<GenerationResult>(
    systemPrompt,
    userPrompt,
    {
      model: 'claude-opus-4-20250514',
      maxTokens: 4096,
      temperature: 0.3,
    }
  );

  return {
    ...result,
    ebaySoldItems: ebaySoldData,
  };
}

/**
 * Generate a listing with an image for additional context
 */
export async function generateListingWithImage(
  item: string,
  condition: ListingCondition,
  keyPoints: string,
  templateContent: string,
  tone: ListingTone,
  imageBase64: string,
  ebaySoldData?: EbaySoldItem[]
): Promise<GenerationResult> {
  // First analyze the image with Gemini
  const imageAnalysis = await analyzeProductImage(imageBase64);

  // Then generate the listing with Claude
  return generateListing(
    item,
    condition,
    keyPoints,
    templateContent,
    tone,
    ebaySoldData,
    imageAnalysis
  );
}

// ============================================
// Image Analysis (Gemini)
// ============================================

/**
 * Analyze a product image for eBay listing
 */
export async function analyzeProductImage(
  imageBase64: string
): Promise<ImageAnalysisResult> {
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

If defects are found, phrase the note helpfully like: "Detected a dark spot on the upper left corner. Consider removing before listing."`;

  try {
    console.log('[AI Service] Analyzing product image with Gemini...');

    // Parse the base64 data URL
    const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
    let mimeType: GeminiImageInput['mimeType'] = 'image/jpeg';
    let data = imageBase64;

    if (matches) {
      mimeType = matches[1] as GeminiImageInput['mimeType'];
      data = matches[2];
    }

    const image: GeminiImageInput = {
      base64: data,
      mimeType,
    };

    // Use Gemini Flash for quick analysis
    const response = await analyzeImagesWithGemini([image], prompt, false);

    // Parse JSON response
    let jsonStr = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    return JSON.parse(jsonStr) as ImageAnalysisResult;
  } catch (error) {
    console.error('[AI Service] Image analysis failed:', error);
    // Return default values on error
    return {
      altText: 'Product image',
      defectsNote: null,
      suggestedFilename: 'product_image',
    };
  }
}

/**
 * Analyze an image and suggest edits for defects
 */
export async function analyzeImageForDefects(
  imageBase64: string
): Promise<{ hasDefects: boolean; defectsNote: string | null }> {
  const prompt = `Analyze this product image for visual defects that might affect its appearance in an eBay listing.

Look for:
- Dust or debris on the lens
- Scratches or marks
- Dark spots on white/light backgrounds
- Shadows that obscure the product
- Blurriness or focus issues
- Box damage (dents, creases, tears)

Output JSON:
{
  "hasDefects": true/false,
  "defectsNote": "Description of defects found, or null if none"
}`;

  try {
    const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
    let mimeType: GeminiImageInput['mimeType'] = 'image/jpeg';
    let data = imageBase64;

    if (matches) {
      mimeType = matches[1] as GeminiImageInput['mimeType'];
      data = matches[2];
    }

    const image: GeminiImageInput = {
      base64: data,
      mimeType,
    };

    const response = await analyzeImagesWithGemini([image], prompt, false);

    let jsonStr = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('[AI Service] Defect analysis failed:', error);
    return { hasDefects: false, defectsNote: null };
  }
}

// ============================================
// AI Image Editing (Gemini)
// ============================================

/**
 * Edit an image using AI to fix defects
 *
 * Note: This requires Gemini's image generation capability.
 * If not available, we return the original image with an error.
 */
export async function editImageWithAI(
  imageBase64: string,
  instruction: string
): Promise<{ editedImage: string; success: boolean; error?: string }> {
  // Note: Gemini's image editing capabilities may require specific model versions
  // For now, we'll use the analysis model to provide instructions
  // Actual image editing would require gemini-2.0-flash-exp or similar

  console.log('[AI Service] AI image editing requested:', instruction);

  // Return original image with a note that editing isn't fully implemented
  return {
    editedImage: imageBase64,
    success: false,
    error: 'AI image editing is not yet available. Please edit manually.',
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Extract JSON from a potentially markdown-wrapped response
 */
export function extractJson(text: string): string {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.substring(firstBrace, lastBrace + 1);
  }
  throw new Error('No valid JSON found in response');
}
