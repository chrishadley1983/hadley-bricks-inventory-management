'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSaveQuickFileCredentials } from '@/hooks/use-quickfile-credentials';

interface QuickFileCredentialsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function QuickFileCredentialsModal({
  open,
  onOpenChange,
  onSuccess,
}: QuickFileCredentialsModalProps) {
  const [accountNumber, setAccountNumber] = useState('');
  const [apiKey, setApiKey] = useState('');

  const saveCredentials = useSaveQuickFileCredentials();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!accountNumber.trim() || !apiKey.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    try {
      await saveCredentials.mutateAsync({
        accountNumber: accountNumber.trim(),
        apiKey: apiKey.trim(),
      });

      toast.success('QuickFile credentials saved and verified');

      // Clear form
      setAccountNumber('');
      setApiKey('');

      // Close modal and trigger success callback
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save credentials';
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Connect to QuickFile</DialogTitle>
          <DialogDescription>
            Enter your QuickFile API credentials to enable direct export. You can find these in
            QuickFile under Account Settings &gt; 3rd Party Integration &gt; API.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="accountNumber">Account Number</Label>
              <Input
                id="accountNumber"
                placeholder="e.g., QB00000000"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                disabled={saveCredentials.isPending}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="Your QuickFile API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={saveCredentials.isPending}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saveCredentials.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saveCredentials.isPending}>
              {saveCredentials.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save & Verify
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
