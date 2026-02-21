import { describe, it, expect } from 'vitest';

describe('AI Prompts', () => {
  // ===========================================================================
  // parse-purchase prompt
  // ===========================================================================

  describe('parse-purchase', () => {
    it('should export system prompt', async () => {
      const { PARSE_PURCHASE_SYSTEM_PROMPT } = await import('../prompts/parse-purchase');

      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toBeDefined();
      expect(typeof PARSE_PURCHASE_SYSTEM_PROMPT).toBe('string');
      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('parse natural language');
      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('LEGO');
      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('JSON');
    });

    it('should export createParsePurchaseMessage function', async () => {
      const { createParsePurchaseMessage } = await import('../prompts/parse-purchase');

      expect(typeof createParsePurchaseMessage).toBe('function');
    });

    it('should create message containing user text', async () => {
      const { createParsePurchaseMessage } = await import('../prompts/parse-purchase');

      const message = createParsePurchaseMessage('Bought 75192 from eBay for £450');

      expect(message).toContain('Bought 75192 from eBay for £450');
      expect(message).toContain('Parse this purchase description');
    });

    it('system prompt should include expected fields', async () => {
      const { PARSE_PURCHASE_SYSTEM_PROMPT } = await import('../prompts/parse-purchase');

      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('short_description');
      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('cost');
      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('source');
      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('payment_method');
      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('confidence');
    });

    it('system prompt should recognize common sources', async () => {
      const { PARSE_PURCHASE_SYSTEM_PROMPT } = await import('../prompts/parse-purchase');

      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('eBay');
      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('FB Marketplace');
      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('BrickLink');
      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('Amazon');
    });

    it('system prompt should recognize UK currency', async () => {
      const { PARSE_PURCHASE_SYSTEM_PROMPT } = await import('../prompts/parse-purchase');

      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('UK currency');
      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('£');
      expect(PARSE_PURCHASE_SYSTEM_PROMPT).toContain('GBP');
    });
  });

  // ===========================================================================
  // calculate-distance prompt
  // ===========================================================================

  describe('calculate-distance', () => {
    it('should export system prompt', async () => {
      const { CALCULATE_DISTANCE_SYSTEM_PROMPT } = await import('../prompts/calculate-distance');

      expect(CALCULATE_DISTANCE_SYSTEM_PROMPT).toBeDefined();
      expect(typeof CALCULATE_DISTANCE_SYSTEM_PROMPT).toBe('string');
      expect(CALCULATE_DISTANCE_SYSTEM_PROMPT).toContain('UK postcodes');
      expect(CALCULATE_DISTANCE_SYSTEM_PROMPT).toContain('driving distance');
    });

    it('should export createCalculateDistanceMessage function', async () => {
      const { createCalculateDistanceMessage } = await import('../prompts/calculate-distance');

      expect(typeof createCalculateDistanceMessage).toBe('function');
    });

    it('should create message with both postcodes', async () => {
      const { createCalculateDistanceMessage } = await import('../prompts/calculate-distance');

      const message = createCalculateDistanceMessage('SW1A 1AA', 'M1 1AE');

      expect(message).toContain('SW1A 1AA');
      expect(message).toContain('M1 1AE');
      expect(message).toContain('driving distance');
    });

    it('system prompt should include expected response fields', async () => {
      const { CALCULATE_DISTANCE_SYSTEM_PROMPT } = await import('../prompts/calculate-distance');

      expect(CALCULATE_DISTANCE_SYSTEM_PROMPT).toContain('from_postcode');
      expect(CALCULATE_DISTANCE_SYSTEM_PROMPT).toContain('to_postcode');
      expect(CALCULATE_DISTANCE_SYSTEM_PROMPT).toContain('distance_miles');
      expect(CALCULATE_DISTANCE_SYSTEM_PROMPT).toContain('round_trip_miles');
    });

    it('system prompt should specify miles as unit', async () => {
      const { CALCULATE_DISTANCE_SYSTEM_PROMPT } = await import('../prompts/calculate-distance');

      expect(CALCULATE_DISTANCE_SYSTEM_PROMPT).toContain('miles');
    });
  });

  // ===========================================================================
  // parse-inventory prompt
  // ===========================================================================

  describe('parse-inventory', () => {
    it('should export system prompt', async () => {
      const { PARSE_INVENTORY_SYSTEM_PROMPT } = await import('../prompts/parse-inventory');

      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toBeDefined();
      expect(typeof PARSE_INVENTORY_SYSTEM_PROMPT).toBe('string');
      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('LEGO inventory');
    });

    it('should export createParseInventoryMessage function', async () => {
      const { createParseInventoryMessage } = await import('../prompts/parse-inventory');

      expect(typeof createParseInventoryMessage).toBe('function');
    });

    it('should create message containing user text', async () => {
      const { createParseInventoryMessage } = await import('../prompts/parse-inventory');

      const message = createParseInventoryMessage('3x 75192 and 2x 10294 from eBay');

      expect(message).toContain('3x 75192 and 2x 10294 from eBay');
      expect(message).toContain('Parse this inventory description');
    });

    it('system prompt should support multiple items', async () => {
      const { PARSE_INVENTORY_SYSTEM_PROMPT } = await import('../prompts/parse-inventory');

      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('MULTIPLE items');
      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('items');
      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('quantity');
    });

    it('system prompt should recognize quantity patterns', async () => {
      const { PARSE_INVENTORY_SYSTEM_PROMPT } = await import('../prompts/parse-inventory');

      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('3x 75192');
      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('2 x 10294');
      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('75192 x2');
    });

    it('system prompt should recognize conditions', async () => {
      const { PARSE_INVENTORY_SYSTEM_PROMPT } = await import('../prompts/parse-inventory');

      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('New');
      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('Used');
      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('Sealed');
    });

    it('system prompt should recognize status values', async () => {
      const { PARSE_INVENTORY_SYSTEM_PROMPT } = await import('../prompts/parse-inventory');

      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('NOT YET RECEIVED');
      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('BACKLOG');
      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('LISTED');
      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('SOLD');
    });

    it('system prompt should include shared_fields', async () => {
      const { PARSE_INVENTORY_SYSTEM_PROMPT } = await import('../prompts/parse-inventory');

      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('shared_fields');
      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('total_cost');
      expect(PARSE_INVENTORY_SYSTEM_PROMPT).toContain('total_items');
    });
  });

  // ===========================================================================
  // extract-set-numbers prompt
  // ===========================================================================

  describe('extract-set-numbers', () => {
    it('should export system prompt', async () => {
      const { EXTRACT_SET_NUMBERS_SYSTEM_PROMPT } = await import('../prompts/extract-set-numbers');

      expect(EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toBeDefined();
      expect(typeof EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toBe('string');
      expect(EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toContain('LEGO set numbers');
    });

    it('should export createExtractSetNumbersMessage function', async () => {
      const { createExtractSetNumbersMessage } = await import('../prompts/extract-set-numbers');

      expect(typeof createExtractSetNumbersMessage).toBe('function');
    });

    it('should create singular message for one image', async () => {
      const { createExtractSetNumbersMessage } = await import('../prompts/extract-set-numbers');

      const message = createExtractSetNumbersMessage(1);

      expect(message).toContain('this image');
      expect(message).not.toContain('these');
    });

    it('should create plural message for multiple images', async () => {
      const { createExtractSetNumbersMessage } = await import('../prompts/extract-set-numbers');

      const message = createExtractSetNumbersMessage(3);

      expect(message).toContain('these 3 images');
    });

    it('system prompt should explain set number format', async () => {
      const { EXTRACT_SET_NUMBERS_SYSTEM_PROMPT } = await import('../prompts/extract-set-numbers');

      expect(EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toContain('4 to 6 digit');
      expect(EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toContain('75192');
      expect(EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toContain('10294');
      expect(EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toContain('42100');
    });

    it('system prompt should include confidence scoring', async () => {
      const { EXTRACT_SET_NUMBERS_SYSTEM_PROMPT } = await import('../prompts/extract-set-numbers');

      expect(EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toContain('confidence score');
      expect(EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toContain('0.0 to 1.0');
    });

    it('system prompt should specify JSON response format', async () => {
      const { EXTRACT_SET_NUMBERS_SYSTEM_PROMPT } = await import('../prompts/extract-set-numbers');

      expect(EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toContain('extractions');
      expect(EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toContain('set_number');
      expect(EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toContain('confidence');
    });

    it('system prompt should warn against guessing', async () => {
      const { EXTRACT_SET_NUMBERS_SYSTEM_PROMPT } = await import('../prompts/extract-set-numbers');

      expect(EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toContain('Do not guess');
      expect(EXTRACT_SET_NUMBERS_SYSTEM_PROMPT).toContain('make up numbers');
    });
  });

  // ===========================================================================
  // Type exports
  // ===========================================================================

  describe('type exports', () => {
    it('should export ParsedPurchaseResponse type', async () => {
      const purchaseModule = await import('../prompts/parse-purchase');

      // TypeScript interfaces are not runtime values, but the module should have the exports
      expect(purchaseModule).toHaveProperty('PARSE_PURCHASE_SYSTEM_PROMPT');
      expect(purchaseModule).toHaveProperty('createParsePurchaseMessage');
    });

    it('should export DistanceResponse type', async () => {
      const distanceModule = await import('../prompts/calculate-distance');

      expect(distanceModule).toHaveProperty('CALCULATE_DISTANCE_SYSTEM_PROMPT');
      expect(distanceModule).toHaveProperty('createCalculateDistanceMessage');
    });

    it('should export ParsedInventoryItem type', async () => {
      const inventoryModule = await import('../prompts/parse-inventory');

      expect(inventoryModule).toHaveProperty('PARSE_INVENTORY_SYSTEM_PROMPT');
      expect(inventoryModule).toHaveProperty('createParseInventoryMessage');
    });

    it('should export ExtractSetNumbersResponse type', async () => {
      const extractModule = await import('../prompts/extract-set-numbers');

      expect(extractModule).toHaveProperty('EXTRACT_SET_NUMBERS_SYSTEM_PROMPT');
      expect(extractModule).toHaveProperty('createExtractSetNumbersMessage');
    });
  });

  // ===========================================================================
  // Index exports
  // ===========================================================================

  describe('index exports', () => {
    it('should export all Claude client functions', async () => {
      const aiModule = await import('../index');

      expect(aiModule).toHaveProperty('getClaudeClient');
      expect(aiModule).toHaveProperty('sendMessage');
      expect(aiModule).toHaveProperty('sendMessageForJSON');
      expect(aiModule).toHaveProperty('sendMessageWithImage');
      expect(aiModule).toHaveProperty('sendMessageWithImages');
      expect(aiModule).toHaveProperty('sendMessageWithImagesForJSON');
    });

    it('should export parse-purchase prompt', async () => {
      const aiModule = await import('../index');

      expect(aiModule).toHaveProperty('PARSE_PURCHASE_SYSTEM_PROMPT');
      expect(aiModule).toHaveProperty('createParsePurchaseMessage');
    });

    it('should export calculate-distance prompt', async () => {
      const aiModule = await import('../index');

      expect(aiModule).toHaveProperty('CALCULATE_DISTANCE_SYSTEM_PROMPT');
      expect(aiModule).toHaveProperty('createCalculateDistanceMessage');
    });

    it('should export parse-inventory prompt', async () => {
      const aiModule = await import('../index');

      expect(aiModule).toHaveProperty('PARSE_INVENTORY_SYSTEM_PROMPT');
      expect(aiModule).toHaveProperty('createParseInventoryMessage');
    });

    it('should export extract-set-numbers prompt', async () => {
      const aiModule = await import('../index');

      expect(aiModule).toHaveProperty('EXTRACT_SET_NUMBERS_SYSTEM_PROMPT');
      expect(aiModule).toHaveProperty('createExtractSetNumbersMessage');
    });
  });
});
