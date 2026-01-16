import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

/**
 * Get the Anthropic client instance (singleton)
 */
export function getClaudeClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Send a message to Claude and get a response
 */
export async function sendMessage(
  systemPrompt: string,
  userMessage: string,
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}
): Promise<string> {
  const {
    model = 'claude-sonnet-4-20250514',
    maxTokens = 1024,
    temperature = 0.3,
  } = options;

  const anthropic = getClaudeClient();

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
  });

  // Extract text from the response
  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return textBlock.text;
}

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface ImageInput {
  base64: string;
  mediaType: ImageMediaType;
}

/**
 * Send a message with an image to Claude Vision
 */
export async function sendMessageWithImage(
  systemPrompt: string,
  userMessage: string,
  image: ImageInput,
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}
): Promise<string> {
  const {
    model = 'claude-sonnet-4-20250514',
    maxTokens = 1024,
    temperature = 0.3,
  } = options;

  const anthropic = getClaudeClient();

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mediaType,
              data: image.base64,
            },
          },
          {
            type: 'text',
            text: userMessage,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return textBlock.text;
}

/**
 * Send a message with multiple images to Claude Vision
 */
export async function sendMessageWithImages(
  systemPrompt: string,
  userMessage: string,
  images: ImageInput[],
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}
): Promise<string> {
  const {
    model = 'claude-sonnet-4-20250514',
    maxTokens = 2048,
    temperature = 0.3,
  } = options;

  const anthropic = getClaudeClient();

  const imageContent = images.map((img) => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: img.mediaType,
      data: img.base64,
    },
  }));

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          ...imageContent,
          {
            type: 'text',
            text: userMessage,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return textBlock.text;
}

/**
 * Send a message with image(s) and parse the JSON response
 */
export async function sendMessageWithImagesForJSON<T>(
  systemPrompt: string,
  userMessage: string,
  images: ImageInput[],
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}
): Promise<T> {
  const response = await sendMessageWithImages(systemPrompt, userMessage, images, options);

  // Extract JSON from the response (it may be wrapped in markdown code blocks)
  let jsonStr = response;
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    console.error('Failed to parse JSON response:', response);
    throw new Error('Failed to parse AI response as JSON');
  }
}

/**
 * Send a message and parse the JSON response
 */
export async function sendMessageForJSON<T>(
  systemPrompt: string,
  userMessage: string,
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}
): Promise<T> {
  const response = await sendMessage(systemPrompt, userMessage, options);

  // Extract JSON from the response (it may be wrapped in markdown code blocks)
  let jsonStr = response;
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    console.error('Failed to parse JSON response:', response);
    throw new Error('Failed to parse AI response as JSON');
  }
}

/**
 * Chat message type for multi-turn conversations
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Send a multi-turn conversation to Claude
 * Supports conversation history for contextual responses
 */
export async function sendConversation(
  systemPrompt: string,
  messages: ChatMessage[],
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}
): Promise<string> {
  const {
    model = 'claude-sonnet-4-20250514',
    maxTokens = 1024,
    temperature = 0.5,
  } = options;

  const anthropic = getClaudeClient();

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
  });

  // Extract text from the response
  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return textBlock.text;
}
