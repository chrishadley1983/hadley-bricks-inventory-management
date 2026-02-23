'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Settings, ExternalLink } from 'lucide-react';
import {
  useShopifyConfig,
  useUpdateShopifyConfig,
} from '@/hooks/use-shopify-sync';

export function ShopifyConfigCard() {
  const { data: config, isLoading } = useShopifyConfig();
  const updateConfig = useUpdateShopifyConfig();

  if (isLoading || !config) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-4 bg-muted rounded w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Configuration
        </CardTitle>
        <CardDescription>
          <a
            href={`https://${config.shop_domain}/admin`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            {config.shop_domain}
            <ExternalLink className="h-3 w-3" />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Sync Enabled</Label>
            <p className="text-xs text-muted-foreground">
              Allow products to be pushed to Shopify
            </p>
          </div>
          <Switch
            checked={config.sync_enabled}
            onCheckedChange={(checked: boolean) =>
              updateConfig.mutate({ sync_enabled: checked })
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Auto-Sync New Listings</Label>
            <p className="text-xs text-muted-foreground">
              Automatically push new LISTED items to Shopify
            </p>
          </div>
          <Switch
            checked={config.auto_sync_new_listings}
            onCheckedChange={(checked: boolean) =>
              updateConfig.mutate({ auto_sync_new_listings: checked })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label>Direct Sale Discount (%)</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={50}
              className="w-24"
              defaultValue={config.default_discount_pct}
              onBlur={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 0 && val <= 50 && val !== config.default_discount_pct) {
                  updateConfig.mutate({ default_discount_pct: val });
                }
              }}
            />
            <span className="text-sm text-muted-foreground">
              off marketplace price
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Badge variant="outline">API: {config.api_version}</Badge>
          {config.location_id ? (
            <Badge variant="outline">Location: {config.location_id}</Badge>
          ) : (
            <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
              No location set
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
