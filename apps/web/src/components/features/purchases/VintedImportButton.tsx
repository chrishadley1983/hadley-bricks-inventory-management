'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VintedImportModal } from './VintedImportModal';

interface VintedImportButtonProps {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
}

/**
 * Button that opens the Vinted Import modal
 */
export function VintedImportButton({ variant = 'outline' }: VintedImportButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <Button variant={variant} onClick={() => setIsModalOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Import from Vinted
      </Button>

      <VintedImportModal open={isModalOpen} onOpenChange={setIsModalOpen} />
    </>
  );
}
