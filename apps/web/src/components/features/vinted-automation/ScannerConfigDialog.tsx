/**
 * Scanner Configuration Dialog
 *
 * Modal for updating scanner configuration settings
 */

'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useScannerStatus, useUpdateScannerConfig } from '@/hooks/use-vinted-automation';
import { Loader2 } from 'lucide-react';

// Helper to normalize time to HH:MM format (strips seconds if present)
const timeSchema = z.string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Must be a valid time (HH:MM)')
  .transform((val) => val.slice(0, 5));

const configSchema = z.object({
  broad_sweep_cog_threshold: z.number().min(20).max(60),
  watchlist_cog_threshold: z.number().min(20).max(60),
  near_miss_threshold: z.number().min(30).max(70),
  operating_hours_start: timeSchema,
  operating_hours_end: timeSchema,
});

type ConfigFormValues = z.infer<typeof configSchema>;

interface ScannerConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ScannerConfigDialog({
  open,
  onOpenChange,
}: ScannerConfigDialogProps) {
  const { data } = useScannerStatus();
  const updateConfig = useUpdateScannerConfig();

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      broad_sweep_cog_threshold: 40,
      watchlist_cog_threshold: 40,
      near_miss_threshold: 50,
      operating_hours_start: '08:00',
      operating_hours_end: '22:00',
    },
  });

  // Update form when data loads
  useEffect(() => {
    if (data?.config) {
      form.reset({
        broad_sweep_cog_threshold: data.config.broad_sweep_cog_threshold,
        watchlist_cog_threshold: data.config.watchlist_cog_threshold,
        near_miss_threshold: data.config.near_miss_threshold,
        operating_hours_start: data.config.operating_hours_start,
        operating_hours_end: data.config.operating_hours_end,
      });
    }
  }, [data?.config, form]);

  const onSubmit = (values: ConfigFormValues) => {
    updateConfig.mutate(values, {
      onSuccess: () => {
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Scanner Configuration</DialogTitle>
          <DialogDescription>
            Configure thresholds and operating hours for the automated scanner
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* COG Thresholds */}
            <div className="space-y-4">
              <h4 className="font-medium">COG% Thresholds</h4>

              <FormField
                control={form.control}
                name="broad_sweep_cog_threshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Broad Sweep Threshold: {field.value}%
                    </FormLabel>
                    <FormControl>
                      <Slider
                        value={[field.value]}
                        onValueChange={(values: number[]) => field.onChange(values[0])}
                        min={20}
                        max={60}
                        step={5}
                      />
                    </FormControl>
                    <FormDescription>
                      Items below this COG% from broad sweeps trigger alerts
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="watchlist_cog_threshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Watchlist Threshold: {field.value}%
                    </FormLabel>
                    <FormControl>
                      <Slider
                        value={[field.value]}
                        onValueChange={(values: number[]) => field.onChange(values[0])}
                        min={20}
                        max={60}
                        step={5}
                      />
                    </FormControl>
                    <FormDescription>
                      Items below this COG% from watchlist scans trigger alerts
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="near_miss_threshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Near Miss Threshold: {field.value}%
                    </FormLabel>
                    <FormControl>
                      <Slider
                        value={[field.value]}
                        onValueChange={(values: number[]) => field.onChange(values[0])}
                        min={30}
                        max={70}
                        step={5}
                      />
                    </FormControl>
                    <FormDescription>
                      Items between viable and this % are tracked as near-misses
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Operating Hours */}
            <div className="space-y-4">
              <h4 className="font-medium">Operating Hours</h4>
              <p className="text-sm text-muted-foreground">
                Scanner only runs during these hours to appear more human
              </p>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="operating_hours_start"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Time</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="operating_hours_end"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Time</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateConfig.isPending}>
                {updateConfig.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
