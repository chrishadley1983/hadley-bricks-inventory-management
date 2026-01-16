export {
  getClaudeClient,
  sendMessage,
  sendMessageForJSON,
  sendMessageWithImage,
  sendMessageWithImages,
  sendMessageWithImagesForJSON,
  sendConversation,
  type ImageMediaType,
  type ImageInput,
  type ChatMessage,
} from './claude-client';
export {
  PARSE_PURCHASE_SYSTEM_PROMPT,
  createParsePurchaseMessage,
  type ParsedPurchaseResponse,
} from './prompts/parse-purchase';
export {
  CALCULATE_DISTANCE_SYSTEM_PROMPT,
  createCalculateDistanceMessage,
  type DistanceResponse,
} from './prompts/calculate-distance';
export {
  PARSE_INVENTORY_SYSTEM_PROMPT,
  createParseInventoryMessage,
  type ParsedInventoryItem,
  type ParsedSharedFields,
  type ParsedInventoryResponse,
} from './prompts/parse-inventory';
export {
  EXTRACT_SET_NUMBERS_SYSTEM_PROMPT,
  createExtractSetNumbersMessage,
  type ExtractedSetNumber,
  type ExtractSetNumbersResponse,
} from './prompts/extract-set-numbers';
