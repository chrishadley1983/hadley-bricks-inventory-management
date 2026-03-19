'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ImageIcon } from 'lucide-react';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

function buildImageUrl(imagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/scanner-images/${imagePath}`;
}

interface PieceImageCellProps {
  imagePath: string | null | undefined;
  altText?: string;
}

export function PieceImageCell({ imagePath, altText = 'Scanned piece' }: PieceImageCellProps) {
  const [hasError, setHasError] = useState(false);

  if (!imagePath || hasError) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded border bg-muted">
        <ImageIcon className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  const url = buildImageUrl(imagePath);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="h-12 w-12 cursor-pointer overflow-hidden rounded border hover:opacity-80 transition-opacity">
          <Image
            src={url}
            alt={altText}
            width={48}
            height={48}
            className="h-full w-full object-cover"
            onError={() => setHasError(true)}
          />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{altText}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center">
          <Image
            src={url}
            alt={altText}
            width={600}
            height={600}
            className="max-h-[70vh] w-auto rounded object-contain"
            onError={() => setHasError(true)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
