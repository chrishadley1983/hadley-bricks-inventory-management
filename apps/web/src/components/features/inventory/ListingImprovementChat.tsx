'use client';

/**
 * ListingImprovementChat Component
 *
 * A collapsible chat interface for discussing listing improvements
 * with an AI assistant based on quality review feedback.
 */

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MessageCircle,
  ChevronDown,
  ChevronUp,
  Send,
  Loader2,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import { useListingChat, type ChatMessage } from '@/hooks';
import { cn } from '@/lib/utils';

interface ListingImprovementChatProps {
  auditId: string;
}

/**
 * Individual chat message bubble
 */
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        )}
      >
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  );
}

/**
 * Loading indicator for when waiting for AI response
 */
function ThinkingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-muted rounded-lg px-3 py-2">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

/**
 * Suggested questions to help start the conversation
 */
const SUGGESTED_QUESTIONS = [
  'How can I improve my title?',
  'What item specifics am I missing?',
  'How can I improve my SEO score?',
];

/**
 * Main ListingImprovementChat component
 */
export function ListingImprovementChat({ auditId }: ListingImprovementChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    messages,
    sendMessage,
    isLoading,
    error,
    clearChat,
  } = useListingChat(auditId);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = inputValue.trim();
    if (!message || isLoading) return;

    setInputValue('');
    await sendMessage(message);
  };

  const handleSuggestedQuestion = async (question: string) => {
    if (isLoading) return;
    await sendMessage(question);
  };

  return (
    <Card className="border-t-0 rounded-t-none">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="py-3 cursor-pointer hover:bg-muted/50 transition-colors">
            <CardTitle className="flex items-center justify-between text-base">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-blue-500" />
                <span>Discuss Improvements</span>
                {messages.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    ({messages.length} messages)
                  </span>
                )}
              </div>
              {isOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 pb-3">
            {/* Messages area */}
            <ScrollArea
              ref={scrollRef}
              className="h-[250px] pr-4 mb-3"
            >
              <div className="space-y-3">
                {/* Empty state with suggested questions */}
                {messages.length === 0 && !isLoading && (
                  <div className="text-center py-6">
                    <p className="text-sm text-muted-foreground mb-3">
                      Ask questions about improving your listing
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {SUGGESTED_QUESTIONS.map((question) => (
                        <Button
                          key={question}
                          variant="outline"
                          size="sm"
                          onClick={() => handleSuggestedQuestion(question)}
                          disabled={isLoading}
                        >
                          {question}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Messages */}
                {messages.map((message, index) => (
                  <MessageBubble key={index} message={message} />
                ))}

                {/* Loading indicator */}
                {isLoading && <ThinkingIndicator />}

                {/* Error message */}
                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Input area */}
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask about improvements..."
                disabled={isLoading}
                className="flex-1"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!inputValue.trim() || isLoading}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
              {messages.length > 0 && (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={clearChat}
                  title="Clear chat"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </form>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
