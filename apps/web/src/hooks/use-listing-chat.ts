'use client';

import { useState, useCallback } from 'react';
import type { ChatResponse } from '@/app/api/ebay/listing/[auditId]/chat/route';

/**
 * Chat message type
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Hook return type
 */
export interface UseListingChatReturn {
  /** Current messages in the conversation */
  messages: ChatMessage[];
  /** Send a new message and get a response */
  sendMessage: (message: string) => Promise<void>;
  /** Whether a message is being sent */
  isLoading: boolean;
  /** Error message if last request failed */
  error: string | null;
  /** Clear the chat history */
  clearChat: () => void;
}

/**
 * Hook to manage listing improvement chat state and API calls
 *
 * @param auditId - The listing audit ID for context
 * @returns Chat state and methods
 */
export function useListingChat(auditId: string | undefined): UseListingChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Send a message to the chat API
   */
  const sendMessage = useCallback(
    async (message: string) => {
      if (!auditId || !message.trim()) return;

      setIsLoading(true);
      setError(null);

      // Add user message immediately
      const userMessage: ChatMessage = { role: 'user', content: message };
      setMessages((prev) => [...prev, userMessage]);

      try {
        const response = await fetch(`/api/ebay/listing/${auditId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            conversationHistory: messages,
          }),
        });

        const data: ChatResponse = await response.json();

        if (!response.ok || data.error) {
          throw new Error(data.error || 'Failed to get response');
        }

        // Add assistant response
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: data.response,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        // Remove the user message on error
        setMessages((prev) => prev.slice(0, -1));
      } finally {
        setIsLoading(false);
      }
    },
    [auditId, messages]
  );

  /**
   * Clear the chat history
   */
  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    sendMessage,
    isLoading,
    error,
    clearChat,
  };
}
