'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useReportSettings, useUpdateReportSettings } from '@/hooks/use-reports';
import { useHomeAddress, useUpdateHomeAddress } from '@/hooks/use-mileage';
import { useToast } from '@/hooks/use-toast';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

export default function ReportSettingsPage() {
  const { data: settings, isLoading } = useReportSettings();
  const updateMutation = useUpdateReportSettings();
  const { data: homeAddress, isLoading: isLoadingHomeAddress } = useHomeAddress();
  const updateHomeAddressMutation = useUpdateHomeAddress();
  const { toast } = useToast();

  const handleSave = async (field: string, value: unknown) => {
    try {
      await updateMutation.mutateAsync({ [field]: value });
      toast({
        title: 'Settings saved',
        description: 'Your report settings have been updated.',
      });
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to save settings. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleSaveHomeAddress = async (address: string) => {
    try {
      await updateHomeAddressMutation.mutateAsync(address);
      toast({
        title: 'Home address saved',
        description: 'Your home address has been updated for mileage calculations.',
      });
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to save home address. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Header title="Report Settings" />
      <div className="p-6 space-y-6 max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/reports">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Report Settings</h1>
            <p className="text-muted-foreground">
              Configure default settings for reports
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Business Details */}
            <Card>
              <CardHeader>
                <CardTitle>Business Details</CardTitle>
                <CardDescription>
                  Information displayed on exported reports
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="businessName">Business Name</Label>
                  <Input
                    id="businessName"
                    defaultValue={settings?.businessName || ''}
                    placeholder="Your business name"
                    onBlur={(e) => handleSave('businessName', e.target.value || null)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessAddress">Business Address</Label>
                  <Input
                    id="businessAddress"
                    defaultValue={settings?.businessAddress || ''}
                    placeholder="Your business address"
                    onBlur={(e) => handleSave('businessAddress', e.target.value || null)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Financial Year */}
            <Card>
              <CardHeader>
                <CardTitle>Financial Year</CardTitle>
                <CardDescription>
                  Configure your financial year start month (default: April for UK tax year)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="financialYearStartMonth">Financial Year Starts</Label>
                  <Select
                    value={String(settings?.financialYearStartMonth || 4)}
                    onValueChange={(v: string) => handleSave('financialYearStartMonth', parseInt(v))}
                  >
                    <SelectTrigger id="financialYearStartMonth">
                      <SelectValue placeholder="Select month" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">January</SelectItem>
                      <SelectItem value="2">February</SelectItem>
                      <SelectItem value="3">March</SelectItem>
                      <SelectItem value="4">April (UK Tax Year)</SelectItem>
                      <SelectItem value="5">May</SelectItem>
                      <SelectItem value="6">June</SelectItem>
                      <SelectItem value="7">July</SelectItem>
                      <SelectItem value="8">August</SelectItem>
                      <SelectItem value="9">September</SelectItem>
                      <SelectItem value="10">October</SelectItem>
                      <SelectItem value="11">November</SelectItem>
                      <SelectItem value="12">December</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Display Options */}
            <Card>
              <CardHeader>
                <CardTitle>Display Options</CardTitle>
                <CardDescription>
                  Configure how reports are displayed
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="showComparison"
                    checked={settings?.showPreviousPeriodComparison ?? true}
                    onCheckedChange={(checked: boolean) => handleSave('showPreviousPeriodComparison', checked)}
                  />
                  <Label htmlFor="showComparison" className="cursor-pointer">
                    Show period-over-period comparison by default
                  </Label>
                </div>
              </CardContent>
            </Card>

            {/* Currency Settings */}
            <Card>
              <CardHeader>
                <CardTitle>Currency</CardTitle>
                <CardDescription>
                  Default currency for reports
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="defaultCurrency">Default Currency</Label>
                  <Select
                    value={settings?.defaultCurrency || 'GBP'}
                    onValueChange={(v: string) => handleSave('defaultCurrency', v)}
                  >
                    <SelectTrigger id="defaultCurrency">
                      <SelectValue placeholder="Select currency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GBP">GBP (£)</SelectItem>
                      <SelectItem value="USD">USD ($)</SelectItem>
                      <SelectItem value="EUR">EUR (€)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Mileage Settings */}
            <Card>
              <CardHeader>
                <CardTitle>Mileage Rate</CardTitle>
                <CardDescription>
                  HMRC approved mileage rate for tax deductions (default: 45p/mile)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mileageRate">Rate per Mile (£)</Label>
                  <Input
                    id="mileageRate"
                    type="number"
                    step="0.01"
                    defaultValue={settings?.mileageRate || 0.45}
                    onBlur={(e) => handleSave('mileageRate', parseFloat(e.target.value) || 0.45)}
                  />
                  <p className="text-xs text-muted-foreground">
                    HMRC standard rate is £0.45 per mile for the first 10,000 miles
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Dashboard Targets */}
            <Card>
              <CardHeader>
                <CardTitle>Dashboard Targets</CardTitle>
                <CardDescription>
                  Set daily targets for the dashboard performance tracking
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="dailyListingTarget">Daily Listing Target (£)</Label>
                  <Input
                    id="dailyListingTarget"
                    type="number"
                    step="1"
                    defaultValue={settings?.dailyListingTarget || 200}
                    onBlur={(e) => handleSave('dailyListingTarget', parseFloat(e.target.value) || 200)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Target value of items to list per day. Used for listing performance tracking on the dashboard.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Home Address for Mileage Calculations */}
            <Card>
              <CardHeader>
                <CardTitle>Home Address</CardTitle>
                <CardDescription>
                  Starting point for mileage calculations when collecting purchases
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="homeAddress">Full Address or Postcode</Label>
                  {isLoadingHomeAddress ? (
                    <div className="flex items-center gap-2 h-10">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Loading...</span>
                    </div>
                  ) : (
                    <Input
                      id="homeAddress"
                      defaultValue={homeAddress || ''}
                      placeholder="e.g., TN27 8JT or 123 High Street, Ashford, Kent"
                      onBlur={(e) => handleSaveHomeAddress(e.target.value || '')}
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    This address is used as the starting point when calculating route distances
                    for purchase collections. Enter a full address or postcode.
                  </p>
                </div>
                {updateHomeAddressMutation.isPending && (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Saving...</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Save Status */}
            {updateMutation.isPending && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Saving...</span>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
