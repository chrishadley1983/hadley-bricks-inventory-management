'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Loader2, Check, X, Upload } from 'lucide-react';
import type { PushStatus } from '@/lib/repricing';

interface PushPriceButtonProps {
  status: PushStatus;
  errorMessage?: string | null;
  disabled?: boolean;
  onClick: () => void;
}

export function PushPriceButton({
  status,
  errorMessage,
  disabled = false,
  onClick,
}: PushPriceButtonProps) {
  const [showSuccess, setShowSuccess] = useState(false);

  // Auto-hide success state after 3 seconds
  useEffect(() => {
    if (status === 'success') {
      setShowSuccess(true);
      const timer = setTimeout(() => {
        setShowSuccess(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const isSuccess = status === 'success' || showSuccess;
  const isError = status === 'error';
  const isPushing = status === 'pushing';

  // Button content based on state
  const renderContent = () => {
    if (isPushing) {
      return (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="sr-only">Pushing...</span>
        </>
      );
    }
    if (isSuccess) {
      return (
        <>
          <Check className="h-4 w-4 text-green-600" />
          <span className="sr-only">Success</span>
        </>
      );
    }
    if (isError) {
      return (
        <>
          <X className="h-4 w-4 text-red-600" />
          <span className="sr-only">Error</span>
        </>
      );
    }
    return (
      <>
        <Upload className="h-4 w-4" />
        <span className="sr-only">Push</span>
      </>
    );
  };

  // Button variant based on state
  const getVariant = () => {
    if (isSuccess) return 'outline';
    if (isError) return 'destructive';
    return 'outline';
  };

  // If error, wrap in tooltip to show error message
  if (isError && errorMessage) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={getVariant()}
              size="icon"
              className="h-8 w-8"
              disabled={disabled || isPushing}
              onClick={onClick}
            >
              {renderContent()}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[200px]">
            <p className="text-xs text-red-600">{errorMessage}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Button
      variant={getVariant()}
      size="icon"
      className={`h-8 w-8 ${isSuccess ? 'border-green-500' : ''}`}
      disabled={disabled || isPushing}
      onClick={onClick}
    >
      {renderContent()}
    </Button>
  );
}
