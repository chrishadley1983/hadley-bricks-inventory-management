/**
 * eBay Listing Creation Orchestration Service
 *
 * Coordinates the 9-step listing creation process:
 * 1. Validate - Check inventory item and status
 * 2. Research - Query Brickset API for product details
 * 3. Policies - Get eBay business policies
 * 4. Generate - AI content generation (Claude Opus 4.5)
 * 5. Images - Upload images to storage
 * 6. Create - eBay Inventory API calls
 * 7. Update - Mark inventory as Listed
 * 8. Audit - Record audit trail
 * 9. Review - Quality review (Gemini 2.5 Pro)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@hadley-bricks/database';
import { EbayApiAdapter } from './ebay-api.adapter';
import { EbayAuthService } from './ebay-auth.service';
import { EbayBusinessPoliciesService } from './ebay-business-policies.service';
import { EbayImageUploadService, type ImageUploadData } from './ebay-image-upload.service';
import { ListingGenerationService } from './listing-generation.service';
import { ListingQualityReviewService } from './listing-quality-review.service';
import type {
  ListingCreationRequest,
  ListingCreationProgress,
  ListingCreationResult,
  ListingCreationError,
  ListingCreationStep,
  AIGeneratedListing,
  QualityReviewResult,
} from './listing-creation.types';
import { isListingImageUrl, isListingImageBase64 } from './listing-creation.types';
import type { ListingInventoryInput, ListingResearchData } from '@/lib/ai/prompts/generate-listing';
import { LEGO_CATEGORIES } from '@/lib/ai/prompts/generate-listing';
import type { EbayConditionEnum } from './types';
import { BricksetCredentialsService } from '@/lib/services/brickset-credentials.service';
import { BricksetApiClient } from '@/lib/brickset/brickset-api';
import type { BricksetApiSet } from '@/lib/brickset/types';
import { sendMessageForJSON } from '@/lib/ai/claude-client';

/**
 * Progress callback type
 */
export type ProgressCallback = (progress: ListingCreationProgress) => void;

/**
 * Inventory item data from database
 * Fields match the inventory_items table schema
 */
interface InventoryItem {
  id: string;
  user_id: string;
  set_number: string;
  item_name?: string | null;
  listing_platform?: string | null; // Used as theme fallback
  condition?: string | null;
  notes?: string | null;
  status?: string | null;
  ebay_listing_id?: string | null;
  sku?: string | null;
}

/**
 * Template data from database
 */
interface ListingTemplate {
  id: string;
  content: string;
  type: string;
}

/**
 * Service for orchestrating eBay listing creation
 */
export class ListingCreationService {
  private supabase: SupabaseClient<Database>;
  private userId: string;
  private authService: EbayAuthService;
  private policiesService: EbayBusinessPoliciesService;
  private imageService: EbayImageUploadService;
  private generationService: ListingGenerationService;
  private qualityService: ListingQualityReviewService;
  private bricksetCredentialsService: BricksetCredentialsService;

  // Step tracking
  private steps: ListingCreationStep[] = [];
  private currentStepIndex = -1;
  private startTime: number = 0;

  constructor(supabase: SupabaseClient<Database>, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
    this.authService = new EbayAuthService();
    this.policiesService = new EbayBusinessPoliciesService(supabase, userId);
    this.imageService = new EbayImageUploadService(supabase, userId);
    this.generationService = new ListingGenerationService();
    this.qualityService = new ListingQualityReviewService();
    this.bricksetCredentialsService = new BricksetCredentialsService(supabase);
  }

  /**
   * Create an eBay listing from an inventory item
   *
   * @param request - Listing creation request
   * @param onProgress - Callback for progress updates
   * @returns Listing creation result or error
   */
  async createListing(
    request: ListingCreationRequest,
    onProgress: ProgressCallback
  ): Promise<ListingCreationResult | ListingCreationError> {
    this.startTime = Date.now();
    this.initializeSteps();

    let auditId: string | undefined;
    let generatedListing: AIGeneratedListing | undefined;
    let imageUrls: string[] = [];
    let ebayOfferId: string | undefined;
    let ebayListingId: string | undefined;

    try {
      // Step 1: Validate
      const item = await this.executeStep('validate', onProgress, async () => {
        return this.validateInventoryItem(request.inventoryItemId);
      });

      // Step 2: Research (Brickset API)
      const research = await this.executeStep('research', onProgress, async () => {
        return this.fetchResearchData(item.set_number);
      });

      // Step 3: Get business policies
      const policies = await this.executeStep('policies', onProgress, async () => {
        return this.policiesService.getPolicies();
      });

      // Step 4: Generate listing content with AI
      generatedListing = await this.executeStep('generate', onProgress, async () => {
        const template = request.templateId
          ? await this.getTemplate(request.templateId)
          : undefined;

        const listing = await this.generationService.generateListing(
          this.mapInventoryToInput(item),
          {
            style: request.descriptionStyle,
            template: template
              ? { content: template.content, type: template.type as 'lego_used' | 'lego_new' | 'general' | 'custom' }
              : undefined,
            price: request.price,
          },
          research ?? undefined
        );

        // Apply condition description override if provided
        if (request.conditionDescriptionOverride) {
          listing.conditionDescription = request.conditionDescriptionOverride;
        }

        return listing;
      });

      // Step 5: Upload images (or use pre-uploaded URLs)
      if (request.photos.length > 0) {
        imageUrls = await this.executeStep('images', onProgress, async () => {
          // Check if images are already uploaded (URL-based) or need uploading (base64)
          const urlImages = request.photos.filter(isListingImageUrl);
          const base64Images = request.photos.filter(isListingImageBase64);

          // Collect URLs from pre-uploaded images
          const preUploadedUrls = urlImages.map((img) => img.url);

          // Upload any remaining base64 images (legacy fallback)
          let uploadedUrls: string[] = [];
          if (base64Images.length > 0) {
            console.log(`[ListingCreationService] Uploading ${base64Images.length} base64 images (legacy mode)`);
            const imagesToUpload: ImageUploadData[] = base64Images.map((p) => ({
              id: p.id,
              base64: p.base64,
              mimeType: p.mimeType,
              filename: p.filename,
            }));

            const results = await this.imageService.uploadImages(imagesToUpload);
            uploadedUrls = results.filter((r) => r.success && r.url).map((r) => r.url!);
          }

          const allUrls = [...preUploadedUrls, ...uploadedUrls];

          if (allUrls.length === 0) {
            throw new Error('No images available for listing');
          }

          console.log(`[ListingCreationService] Total images: ${allUrls.length} (${preUploadedUrls.length} pre-uploaded, ${uploadedUrls.length} just uploaded)`);
          return allUrls;
        });
      } else {
        throw new Error('Photos are required for listings');
      }

      // Step 6: Create eBay listing (creates inventory item + offer, publishes)
      const listingResult = await this.executeStep('create', onProgress, async () => {
        return this.createEbayListing(
          item,
          generatedListing!,
          imageUrls,
          request,
          policies.defaults
        );
      });

      ebayOfferId = listingResult.offerId;
      ebayListingId = listingResult.listingId;

      // Step 7: Update inventory item
      await this.executeStep('update', onProgress, async () => {
        return this.updateInventoryItem(
          request.inventoryItemId,
          ebayListingId!,
          `https://www.ebay.co.uk/itm/${ebayListingId}`
        );
      });

      // Step 8: Create audit record
      auditId = await this.executeStep('audit', onProgress, async () => {
        return this.createAuditRecord(
          request,
          item,
          generatedListing!,
          ebayListingId ?? undefined,
          ebayOfferId ?? undefined,
          'completed'
        );
      });

      // Step 9: Quality review (async, non-blocking)
      // This runs in the background AFTER we return the response
      // So we use a no-op progress callback to avoid writing to closed stream
      let qualityReview: QualityReviewResult | undefined;
      const qualityPending = true;

      // Start quality review but don't block on it
      // Use no-op callback since the SSE stream will be closed by the time this completes
      const noOpProgress: ProgressCallback = () => {};
      const reviewStartTime = Date.now();
      this.executeStep('review', noOpProgress, async () => {
        const review = await this.qualityService.reviewListing(
          generatedListing!,
          item.condition ?? 'Used'
        );
        qualityReview = review;

        // Update audit record with quality review results
        const reviewDuration = Date.now() - reviewStartTime;
        await this.updateAuditWithQualityReview(auditId!, review, reviewDuration);

        return review;
      }).catch((error) => {
        console.error('[ListingCreationService] Quality review failed:', error);
        // Update audit record with failure
        this.updateAuditWithQualityReviewFailure(auditId!, error).catch(() => {});
      });

      // Return success immediately, quality review continues in background
      const totalTime = Date.now() - this.startTime;

      return {
        success: true,
        listingId: ebayListingId!,
        offerId: ebayOfferId!,
        listingUrl: `https://www.ebay.co.uk/itm/${ebayListingId}`,
        title: generatedListing!.title,
        price: request.price,
        listingType: request.listingType,
        scheduledDate: request.scheduledDate,
        generatedContent: generatedListing!,
        qualityReview,
        qualityReviewPending: qualityPending,
        auditId: auditId!,
        totalTimeMs: totalTime,
      };
    } catch (error) {
      const failedStep = this.steps.find((s) => s.status === 'failed')?.id ?? 'unknown';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      console.error(`[ListingCreationService] Listing creation failed at step ${failedStep}:`, error);

      // Clean up uploaded images on failure
      if (imageUrls.length > 0) {
        await this.imageService.deleteImages(imageUrls).catch(() => {});
      }

      // Try to create audit record for the failure
      if (!auditId) {
        try {
          auditId = await this.createAuditRecord(
            request,
            undefined,
            generatedListing,
            undefined,
            undefined,
            'failed',
            errorMessage,
            failedStep
          );
        } catch {
          // Ignore audit creation failure
        }
      }

      // Try to save draft for recovery
      let draftId: string | undefined;
      try {
        draftId = await this.saveDraft(request, errorMessage, failedStep);
      } catch {
        // Ignore draft save failure
      }

      return {
        success: false,
        error: errorMessage,
        failedStep,
        errorDetails: error instanceof Error ? { stack: error.stack } : undefined,
        auditId,
        draftSaved: !!draftId,
        draftId,
      };
    }
  }

  /**
   * Initialize step tracking
   */
  private initializeSteps(): void {
    const stepDefs: Array<{ id: string; name: string }> = [
      { id: 'validate', name: 'Validating inventory data' },
      { id: 'research', name: 'Researching product details' },
      { id: 'policies', name: 'Retrieving eBay policies' },
      { id: 'generate', name: 'Generating listing content' },
      { id: 'images', name: 'Processing and uploading images' },
      { id: 'create', name: 'Creating eBay listing' },
      { id: 'update', name: 'Updating inventory' },
      { id: 'audit', name: 'Recording audit trail' },
      { id: 'review', name: 'Quality review' },
    ];

    this.steps = stepDefs.map((s) => ({
      ...s,
      status: 'pending',
    }));
    this.currentStepIndex = -1;
  }

  /**
   * Execute a step with progress tracking
   */
  private async executeStep<T>(
    stepId: string,
    onProgress: ProgressCallback,
    fn: () => Promise<T>
  ): Promise<T> {
    const stepIndex = this.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) {
      throw new Error(`Unknown step: ${stepId}`);
    }

    this.currentStepIndex = stepIndex;
    this.steps[stepIndex].status = 'in_progress';
    const stepStartTime = Date.now();

    // Send progress update
    onProgress(this.getProgress());

    try {
      const result = await fn();

      this.steps[stepIndex].status = 'completed';
      this.steps[stepIndex].durationMs = Date.now() - stepStartTime;

      // Send completion update
      onProgress(this.getProgress());

      return result;
    } catch (error) {
      this.steps[stepIndex].status = 'failed';
      this.steps[stepIndex].error = error instanceof Error ? error.message : 'Unknown error';
      this.steps[stepIndex].durationMs = Date.now() - stepStartTime;

      onProgress(this.getProgress());

      throw error;
    }
  }

  /**
   * Skip a step (mark as completed without executing)
   * Used for draft listings where certain steps are not needed
   */
  private skipStep(stepId: string, onProgress: ProgressCallback): void {
    const stepIndex = this.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) {
      throw new Error(`Unknown step: ${stepId}`);
    }

    this.currentStepIndex = stepIndex;
    this.steps[stepIndex].status = 'completed';
    this.steps[stepIndex].durationMs = 0;

    // Send progress update
    onProgress(this.getProgress());
  }

  /**
   * Get current progress state
   */
  private getProgress(): ListingCreationProgress {
    const completedSteps = this.steps.filter((s) => s.status === 'completed').length;
    const percentage = Math.round((completedSteps / this.steps.length) * 100);
    const currentStep = this.steps[this.currentStepIndex];

    return {
      currentStep: this.currentStepIndex,
      totalSteps: this.steps.length,
      percentage,
      stepName: currentStep?.name ?? 'Initializing',
      message: this.getStepMessage(currentStep),
      steps: [...this.steps],
    };
  }

  /**
   * Get detailed message for current step
   */
  private getStepMessage(step?: ListingCreationStep): string {
    if (!step) return 'Preparing...';

    switch (step.status) {
      case 'in_progress':
        return `${step.name}...`;
      case 'completed':
        return `${step.name} completed`;
      case 'failed':
        return `${step.name} failed: ${step.error}`;
      default:
        return step.name;
    }
  }

  /**
   * Validate the inventory item exists and is eligible
   */
  private async validateInventoryItem(itemId: string): Promise<InventoryItem> {
    const { data: item, error } = await this.supabase
      .from('inventory_items')
      .select('*')
      .eq('id', itemId)
      .eq('user_id', this.userId)
      .single();

    if (error || !item) {
      throw new Error('Inventory item not found');
    }

    if (item.ebay_listing_id) {
      throw new Error('Item already has an eBay listing');
    }

    if (item.status === 'SOLD') {
      throw new Error('Cannot create listing for sold item');
    }

    return item as InventoryItem;
  }

  /**
   * Fetch research data from Brickset API with AI fallback
   * Returns enriched product data for AI listing generation
   *
   * 1. First tries Brickset API (most accurate)
   * 2. Falls back to Claude AI knowledge if Brickset fails or has insufficient data
   */
  private async fetchResearchData(setNumber: string): Promise<ListingResearchData | null> {
    let bricksetData: ListingResearchData | null = null;

    // Step 1: Try Brickset API first
    try {
      bricksetData = await this.fetchBricksetData(setNumber);
    } catch (error) {
      console.error('[ListingCreationService] Brickset lookup failed:', error);
    }

    // Step 2: Check if Brickset data is sufficient
    if (bricksetData && this.isResearchDataSufficient(bricksetData)) {
      console.log('[ListingCreationService] Brickset data is sufficient');
      return bricksetData;
    }

    // Step 3: Fall back to AI knowledge if Brickset data is missing or insufficient
    console.log('[ListingCreationService] Brickset data insufficient, falling back to AI knowledge');
    try {
      const aiData = await this.fetchAIResearchData(setNumber, bricksetData);
      return aiData;
    } catch (error) {
      console.error('[ListingCreationService] AI research fallback failed:', error);
      // Return whatever Brickset data we have, even if incomplete
      return bricksetData;
    }
  }

  /**
   * Fetch data from Brickset API
   */
  private async fetchBricksetData(setNumber: string): Promise<ListingResearchData | null> {
    // Get Brickset API key for the user
    const apiKey = await this.bricksetCredentialsService.getApiKey(this.userId);

    if (!apiKey) {
      console.log('[ListingCreationService] No Brickset API key configured');
      return null;
    }

    // Create Brickset client and fetch set data
    const client = new BricksetApiClient(apiKey);

    // Normalize set number - Brickset expects format like "75192-1"
    const normalizedSetNumber = this.normalizeBricksetSetNumber(setNumber);

    console.log(`[ListingCreationService] Fetching Brickset data for set ${normalizedSetNumber}`);

    let bricksetSet = await client.getSetByNumber(normalizedSetNumber);

    if (!bricksetSet) {
      // Try without variant suffix
      const baseSetNumber = setNumber.split('-')[0];
      console.log(`[ListingCreationService] Set not found, trying base number: ${baseSetNumber}-1`);
      bricksetSet = await client.getSetByNumber(`${baseSetNumber}-1`);

      if (!bricksetSet) {
        console.log(`[ListingCreationService] Set ${setNumber} not found in Brickset`);
        return null;
      }
    }

    // Update last used timestamp
    await this.bricksetCredentialsService.updateLastUsed(this.userId);

    return this.transformBricksetToResearch(bricksetSet);
  }

  /**
   * Check if research data has sufficient information for listing generation
   * Returns true if the essential fields are populated
   */
  private isResearchDataSufficient(data: ListingResearchData): boolean {
    // Essential fields: setName, theme, pieces (at minimum)
    const hasSetName = !!data.setName && data.setName.length > 0;
    const hasTheme = !!data.theme && data.theme.length > 0;
    const hasPieces = data.pieces !== undefined && data.pieces > 0;

    // Consider data sufficient if we have name, theme, and pieces
    const sufficient = hasSetName && hasTheme && hasPieces;

    console.log(`[ListingCreationService] Research data check: name=${hasSetName}, theme=${hasTheme}, pieces=${hasPieces}, sufficient=${sufficient}`);

    return sufficient;
  }

  /**
   * Fetch research data using Claude AI's knowledge
   * Used as fallback when Brickset data is unavailable or insufficient
   */
  private async fetchAIResearchData(
    setNumber: string,
    existingData: ListingResearchData | null
  ): Promise<ListingResearchData | null> {
    const systemPrompt = `You are a LEGO set database expert. Your task is to provide accurate information about LEGO sets.

IMPORTANT:
- Only provide information you are confident about
- If you're not sure about a field, leave it out
- Set numbers are 4-6 digits (e.g., 75192, 10281, 42115)
- Piece counts should be realistic for the set type
- Age ranges are typically like "6+", "8+", "16+", or "8-12"

Return ONLY valid JSON, no other text.`;

    const existingContext = existingData
      ? `\n\nI already have some partial data:\n${JSON.stringify(existingData, null, 2)}\n\nPlease fill in any missing fields.`
      : '';

    const userMessage = `What information do you know about LEGO set number ${setNumber}?${existingContext}

Return JSON with these fields (omit any you're not confident about):
{
  "setName": "Official set name",
  "theme": "LEGO theme (e.g., Star Wars, Technic, City)",
  "subtheme": "Subtheme if applicable (e.g., Ultimate Collector Series)",
  "pieces": 1234,
  "minifigs": 5,
  "year": 2023,
  "retired": true/false,
  "ageRange": "16+",
  "description": "Brief description of the set"
}`;

    try {
      const aiResponse = await sendMessageForJSON<Partial<ListingResearchData>>(
        systemPrompt,
        userMessage,
        {
          model: 'claude-sonnet-4-20250514', // Use Sonnet for faster response
          maxTokens: 1024,
          temperature: 0.2, // Low temperature for factual responses
        }
      );

      // Merge with existing data (existing takes priority for populated fields)
      const merged: ListingResearchData = {
        setName: existingData?.setName || aiResponse.setName,
        theme: existingData?.theme || aiResponse.theme,
        subtheme: existingData?.subtheme || aiResponse.subtheme,
        pieces: existingData?.pieces || aiResponse.pieces,
        minifigs: existingData?.minifigs || aiResponse.minifigs,
        year: existingData?.year || aiResponse.year,
        retired: existingData?.retired ?? aiResponse.retired,
        ageRange: existingData?.ageRange || aiResponse.ageRange,
        dimensions: existingData?.dimensions,
        description: existingData?.description || aiResponse.description,
        barcode: existingData?.barcode,
      };

      console.log('[ListingCreationService] AI research data merged:', merged);

      return merged;
    } catch (error) {
      console.error('[ListingCreationService] AI research failed:', error);
      return existingData;
    }
  }

  /**
   * Normalize set number for Brickset API
   * Brickset expects format like "75192-1" (with variant suffix)
   */
  private normalizeBricksetSetNumber(setNumber: string): string {
    // If already has variant suffix, use as-is
    if (setNumber.includes('-')) {
      return setNumber;
    }

    // Add default variant "-1"
    return `${setNumber}-1`;
  }

  /**
   * Transform Brickset API response to ListingResearchData format
   */
  private transformBricksetToResearch(set: BricksetApiSet): ListingResearchData {
    // Format age range (e.g., "16+" or "8-14")
    let ageRange: string | undefined;
    if (set.ageRange?.min) {
      if (set.ageRange.max && set.ageRange.max !== set.ageRange.min) {
        ageRange = `${set.ageRange.min}-${set.ageRange.max}`;
      } else {
        ageRange = `${set.ageRange.min}+`;
      }
    }

    // Format dimensions (e.g., "38 x 26 x 7 cm")
    let dimensions: string | undefined;
    if (set.dimensions?.width || set.dimensions?.height || set.dimensions?.depth) {
      const parts: string[] = [];
      if (set.dimensions.width) parts.push(`${set.dimensions.width}`);
      if (set.dimensions.depth) parts.push(`${set.dimensions.depth}`);
      if (set.dimensions.height) parts.push(`${set.dimensions.height}`);
      if (parts.length > 0) {
        dimensions = `${parts.join(' x ')} cm`;
      }
    }

    // Determine if set is retired based on availability
    const retired = set.availability === 'Retired' ||
      Boolean(set.LEGOCom?.UK?.dateLastAvailable && set.LEGOCom.UK.dateLastAvailable !== '');

    console.log(`[ListingCreationService] Brickset data transformed:`, {
      setName: set.name,
      theme: set.theme,
      subtheme: set.subtheme,
      pieces: set.pieces,
      minifigs: set.minifigs,
      year: set.year,
      retired,
    });

    return {
      setName: set.name,
      theme: set.theme,
      subtheme: set.subtheme || undefined,
      pieces: set.pieces || undefined,
      minifigs: set.minifigs || undefined,
      year: set.year,
      retired,
      ageRange,
      dimensions,
      description: set.extendedData?.description || undefined,
      barcode: set.barcode?.EAN || set.barcode?.UPC || undefined,
    };
  }

  /**
   * Get template by ID
   */
  private async getTemplate(templateId: string): Promise<ListingTemplate | null> {
    const { data, error } = await this.supabase
      .from('listing_templates')
      .select('id, content, type')
      .eq('id', templateId)
      .eq('user_id', this.userId)
      .single();

    if (error || !data) {
      return null;
    }

    return data as ListingTemplate;
  }

  /**
   * Map inventory item to AI input format
   * Note: Many fields are not available in the current schema and will be
   * sourced from Brickset research data instead
   */
  private mapInventoryToInput(item: InventoryItem): ListingInventoryInput {
    return {
      setNumber: item.set_number,
      setName: item.item_name ?? undefined,
      theme: item.listing_platform ?? undefined, // Theme may come from research data
      condition: item.condition ?? 'Used',
      conditionNotes: undefined, // Will be derived from notes or research
      pieceCount: undefined, // Will come from Brickset research
      minifigureCount: undefined, // Will come from Brickset research
      yearReleased: undefined, // Will come from Brickset research
      isRetired: undefined, // Will come from Brickset research
      hasBox: undefined, // Not tracked in current schema
      hasInstructions: undefined, // Not tracked in current schema
      notes: item.notes ?? undefined,
    };
  }

  /**
   * Create eBay listing via Inventory API
   */
  private async createEbayListing(
    item: InventoryItem,
    listing: AIGeneratedListing,
    imageUrls: string[],
    request: ListingCreationRequest,
    defaultPolicies: { fulfillmentPolicyId?: string; paymentPolicyId?: string; returnPolicyId?: string }
  ): Promise<{ offerId: string; listingId: string }> {
    // Get access token
    const accessToken = await this.authService.getAccessToken(this.userId);
    if (!accessToken) {
      throw new Error('No valid eBay access token');
    }

    // Create API adapter
    const adapter = new EbayApiAdapter({
      accessToken,
      marketplaceId: 'EBAY_GB',
      userId: this.userId,
    });

    // Generate SKU
    const sku = `HADLEY-${item.set_number}-${Date.now()}`;

    // Get or create merchant location
    const merchantLocationKey = await this.getOrCreateMerchantLocation(adapter);
    console.log('[ListingCreationService] Using merchant location:', merchantLocationKey);

    // Step 1: Create or update inventory item
    // Use the inventory item's condition directly (not AI-generated)
    // For LEGO categories, eBay only supports NEW or USED
    const ebayCondition = this.mapConditionToEbayEnum(item.condition);
    console.log(`[ListingCreationService] Condition mapping: "${item.condition}" -> "${ebayCondition}"`);

    const inventoryItemRequest = {
      product: {
        title: listing.title,
        description: listing.description,
        aspects: this.mapItemSpecificsToAspects(listing.itemSpecifics),
        imageUrls,
      },
      condition: ebayCondition as EbayConditionEnum,
      conditionDescription: listing.conditionDescription ?? undefined,
      availability: {
        shipToLocationAvailability: {
          quantity: 1,
        },
      },
    };

    console.log('[ListingCreationService] Creating inventory item with SKU:', sku);
    console.log('[ListingCreationService] Inventory item request:', JSON.stringify(inventoryItemRequest, null, 2));

    await adapter.createOrReplaceInventoryItem(sku, inventoryItemRequest);

    // Step 2: Create offer
    const policyIds = {
      fulfillmentPolicyId:
        request.policyOverrides?.fulfillmentPolicyId ?? defaultPolicies.fulfillmentPolicyId,
      paymentPolicyId:
        request.policyOverrides?.paymentPolicyId ?? defaultPolicies.paymentPolicyId,
      returnPolicyId:
        request.policyOverrides?.returnPolicyId ?? defaultPolicies.returnPolicyId,
    };

    if (!policyIds.fulfillmentPolicyId || !policyIds.paymentPolicyId || !policyIds.returnPolicyId) {
      throw new Error('Missing required eBay business policies');
    }

    // Validate category ID is a valid leaf category
    const validatedCategoryId = this.validateCategoryId(listing.categoryId);

    const offerRequest = {
      sku,
      marketplaceId: 'EBAY_GB',
      format: 'FIXED_PRICE' as const,
      availableQuantity: 1,
      categoryId: validatedCategoryId,
      listingDescription: listing.description,
      merchantLocationKey,
      listingPolicies: {
        fulfillmentPolicyId: policyIds.fulfillmentPolicyId,
        paymentPolicyId: policyIds.paymentPolicyId,
        returnPolicyId: policyIds.returnPolicyId,
      },
      pricingSummary: {
        price: {
          value: request.price.toFixed(2),
          currency: 'GBP',
        },
      },
      // Best Offer configuration
      bestOffer: request.bestOffer.enabled
        ? {
            bestOfferEnabled: true,
            autoAcceptPrice: {
              value: ((request.price * request.bestOffer.autoAcceptPercent) / 100).toFixed(2),
              currency: 'GBP',
            },
            autoDeclinePrice: {
              value: ((request.price * request.bestOffer.autoDeclinePercent) / 100).toFixed(2),
              currency: 'GBP',
            },
          }
        : { bestOfferEnabled: false },
      // Scheduled listing (if applicable)
      // eBay requires ISO 8601 format with timezone (e.g., 2026-01-15T14:31:00.000Z)
      listingStartDate:
        request.listingType === 'scheduled' && request.scheduledDate
          ? this.formatScheduledDate(request.scheduledDate)
          : undefined,
    };

    console.log('[ListingCreationService] Creating offer with request:', JSON.stringify(offerRequest, null, 2));

    const offerResponse = await adapter.createOffer(offerRequest);

    // Step 3: Publish offer
    const publishResponse = await adapter.publishOffer(offerResponse.offerId);
    return {
      offerId: offerResponse.offerId,
      listingId: publishResponse.listingId,
    };
  }

  /**
   * Format scheduled date to ISO 8601 format required by eBay
   * Input format from datetime-local: "2026-01-15T14:31"
   * Output format for eBay: "2026-01-15T14:31:00.000Z"
   */
  private formatScheduledDate(dateString: string): string {
    // If already in ISO format, return as-is
    if (dateString.endsWith('Z') || dateString.includes('+')) {
      return dateString;
    }

    // Parse the datetime-local format and convert to ISO
    // datetime-local gives us local time, so we need to convert to UTC
    const localDate = new Date(dateString);

    // Validate the date is valid
    if (isNaN(localDate.getTime())) {
      throw new Error(`Invalid scheduled date format: ${dateString}`);
    }

    // Return ISO string (UTC)
    return localDate.toISOString();
  }

  /**
   * Validate and ensure category ID is a valid eBay leaf category
   * Falls back to LEGO Complete Sets & Packs if invalid
   */
  private validateCategoryId(categoryId: string): string {
    const validCategories = Object.values(LEGO_CATEGORIES);

    if (validCategories.includes(categoryId)) {
      return categoryId;
    }

    // Log the invalid category and fall back to complete sets
    console.warn(
      `[ListingCreationService] Invalid category ID "${categoryId}" - falling back to LEGO Complete Sets & Packs (${LEGO_CATEGORIES.COMPLETE_SET})`
    );

    return LEGO_CATEGORIES.COMPLETE_SET;
  }

  /**
   * eBay's maximum character limit for item specific values
   */
  private static readonly EBAY_ASPECT_MAX_LENGTH = 65;

  /**
   * Map inventory item condition to eBay condition enum.
   * eBay's API doesn't accept plain "USED" - it requires USED_EXCELLENT or similar.
   * For LEGO categories, we use NEW or USED_EXCELLENT.
   */
  private mapConditionToEbayEnum(condition: string | null | undefined): 'NEW' | 'USED_EXCELLENT' {
    if (!condition) {
      return 'USED_EXCELLENT';
    }
    const normalised = condition.toLowerCase().trim();
    // Treat "New", "Sealed", "Factory Sealed", "Brand New" etc. as NEW
    if (normalised === 'new' || normalised.includes('sealed') || normalised.includes('brand new')) {
      return 'NEW';
    }
    // Everything else is USED_EXCELLENT (eBay doesn't accept plain "USED")
    return 'USED_EXCELLENT';
  }

  /**
   * Truncate a value to fit within eBay's 65 character limit.
   * For comma-separated values, truncates at the last complete item that fits.
   */
  private truncateAspectValue(value: string): string {
    const maxLength = ListingCreationService.EBAY_ASPECT_MAX_LENGTH;

    if (value.length <= maxLength) {
      return value;
    }

    // Check if this is a comma-separated list
    if (value.includes(',')) {
      const items = value.split(',').map(item => item.trim());
      let result = '';

      for (const item of items) {
        const testValue = result ? `${result}, ${item}` : item;
        if (testValue.length <= maxLength) {
          result = testValue;
        } else {
          break;
        }
      }

      // If we got at least one item, return it
      if (result) {
        return result;
      }
    }

    // Simple truncation with ellipsis for non-list values or if no items fit
    return value.substring(0, maxLength - 3) + '...';
  }

  /**
   * Map item specifics to eBay aspects format
   * Adds Country of Origin as Denmark for LEGO items
   * Truncates values that exceed eBay's 65 character limit
   */
  private mapItemSpecificsToAspects(
    specifics: AIGeneratedListing['itemSpecifics']
  ): Record<string, string[]> {
    const aspects: Record<string, string[]> = {};

    for (const [key, value] of Object.entries(specifics)) {
      if (value !== undefined && value !== null && value !== '') {
        const truncatedValue = this.truncateAspectValue(value);
        if (truncatedValue !== value) {
          console.log(
            `[ListingCreationService] Truncated "${key}" from ${value.length} to ${truncatedValue.length} chars: "${truncatedValue}"`
          );
        }
        aspects[key] = [truncatedValue];
      }
    }

    // Add Country of Origin as Denmark for LEGO items
    // eBay requires this for customs compliance
    if (specifics.Brand?.toUpperCase() === 'LEGO') {
      aspects['Country/Region of Manufacture'] = ['Denmark'];
    }

    return aspects;
  }

  /**
   * Update inventory item with eBay listing info
   */
  private async updateInventoryItem(
    itemId: string,
    listingId: string,
    listingUrl: string
  ): Promise<void> {
    const { error } = await this.supabase
      .from('inventory_items')
      .update({
        ebay_listing_id: listingId,
        ebay_listing_url: listingUrl,
        status: 'LISTED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId)
      .eq('user_id', this.userId);

    if (error) {
      throw new Error(`Failed to update inventory: ${error.message}`);
    }
  }

  /**
   * Create audit record
   */
  private async createAuditRecord(
    request: ListingCreationRequest,
    item: InventoryItem | undefined,
    listing: AIGeneratedListing | undefined,
    listingId: string | undefined,
    offerId: string | undefined,
    status: 'completed' | 'failed',
    errorMessage?: string,
    errorStep?: string
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from('listing_creation_audit')
      .insert({
        user_id: this.userId,
        inventory_item_id: request.inventoryItemId,
        ebay_listing_id: listingId,
        action: 'create_listing',
        status,
        listing_price: request.price,
        description_style: request.descriptionStyle,
        template_id: request.templateId,
        photos_enhanced: request.enhancePhotos,
        listing_type: request.listingType,
        scheduled_date: request.scheduledDate,
        generated_title: listing?.title,
        generated_description: listing?.description,
        item_specifics: listing?.itemSpecifics,
        category_id: listing?.categoryId,
        ai_model_used: 'claude-opus-4-5-20251101',
        ai_confidence_score: listing?.confidence,
        ai_recommendations: listing?.recommendations,
        error_message: errorMessage,
        error_step: errorStep,
        completed_at: status === 'completed' ? new Date().toISOString() : undefined,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to create audit record: ${error.message}`);
    }

    return data.id;
  }

  /**
   * Get or create a default merchant location
   */
  private async getOrCreateMerchantLocation(adapter: EbayApiAdapter): Promise<string> {
    const DEFAULT_LOCATION_KEY = 'HADLEY_BRICKS_DEFAULT';

    try {
      // Try to get existing locations
      const locationsResponse = await adapter.getInventoryLocations();
      const locations = locationsResponse.locations || [];

      console.log('[ListingCreationService] Found existing locations:', locations.length);

      if (locations.length > 0) {
        // Use first available location
        const existingLocation = locations[0];
        console.log('[ListingCreationService] Using existing location:', existingLocation.merchantLocationKey);
        return existingLocation.merchantLocationKey;
      }
    } catch {
      // No locations found, will create one
      console.log('[ListingCreationService] No existing locations found, creating default');
    }

    // Create default location for UK
    try {
      await adapter.createInventoryLocation(DEFAULT_LOCATION_KEY, {
        location: {
          address: {
            city: 'London',
            postalCode: 'EC1A 1BB',
            country: 'GB',
          },
        },
        locationTypes: ['WAREHOUSE'],
        name: 'Hadley Bricks Default Location',
        merchantLocationStatus: 'ENABLED',
      });
      console.log('[ListingCreationService] Created default location:', DEFAULT_LOCATION_KEY);
      return DEFAULT_LOCATION_KEY;
    } catch (createError) {
      // Location might already exist (race condition or previous attempt)
      console.log('[ListingCreationService] Error creating location, may already exist:', createError);
      return DEFAULT_LOCATION_KEY;
    }
  }

  /**
   * Save draft for error recovery
   */
  private async saveDraft(
    request: ListingCreationRequest,
    errorMessage: string,
    errorStep: string
  ): Promise<string> {
    const draftData = {
      price: request.price,
      bestOffer: request.bestOffer,
      photos: request.photos.map((p) => ({ id: p.id, filename: p.filename })), // Don't store full base64
      enhancePhotos: request.enhancePhotos,
      descriptionStyle: request.descriptionStyle,
      templateId: request.templateId,
      listingType: request.listingType,
      scheduledDate: request.scheduledDate,
      policyOverrides: request.policyOverrides,
    };

    const errorContext = {
      error: errorMessage,
      failedStep: errorStep,
      timestamp: new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from('listing_local_drafts')
      .insert({
        user_id: this.userId,
        inventory_item_id: request.inventoryItemId,
        draft_data: draftData as unknown as Json,
        error_context: errorContext as unknown as Json,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to save draft: ${error.message}`);
    }

    return data.id;
  }

  /**
   * Update audit record with quality review results
   */
  private async updateAuditWithQualityReview(
    auditId: string,
    review: QualityReviewResult,
    durationMs: number
  ): Promise<void> {
    const { error } = await this.supabase
      .from('listing_creation_audit')
      .update({
        quality_score: review.score,
        quality_feedback: review as unknown as Json,
        quality_review_time_ms: durationMs,
      })
      .eq('id', auditId)
      .eq('user_id', this.userId);

    if (error) {
      console.error('[ListingCreationService] Failed to update audit with quality review:', error);
    } else {
      console.log('[ListingCreationService] Quality review saved to audit record:', auditId);
    }
  }

  /**
   * Update audit record when quality review fails
   */
  private async updateAuditWithQualityReviewFailure(
    auditId: string,
    error: unknown
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : 'Quality review failed';

    const { error: updateError } = await this.supabase
      .from('listing_creation_audit')
      .update({
        quality_score: null,
        quality_feedback: { error: errorMessage, failed: true } as unknown as Json,
      })
      .eq('id', auditId)
      .eq('user_id', this.userId);

    if (updateError) {
      console.error('[ListingCreationService] Failed to update audit with quality review failure:', updateError);
    }
  }
}
