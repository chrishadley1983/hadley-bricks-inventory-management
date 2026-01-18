'use client';

/**
 * Assumptions Panel Component
 * F9-F14: All assumption inputs organized in collapsible sections
 * F49: Uses accordion for collapsible sections
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import type { CostModelScenarioFormData } from '@/types/cost-modelling';

interface AssumptionsPanelProps {
  data: CostModelScenarioFormData;
  onChange: (updates: Partial<CostModelScenarioFormData>) => void;
  disabled?: boolean;
  /** Compact mode for compare view - collapsed by default */
  compact?: boolean;
}

export function AssumptionsPanel({ data, onChange, disabled, compact }: AssumptionsPanelProps) {
  const handleNumberChange = (field: keyof CostModelScenarioFormData) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = parseFloat(e.target.value);
    // E4: Prevent negative values
    if (!isNaN(value) && value >= 0) {
      onChange({ [field]: value });
    }
  };

  const handlePercentChange = (field: keyof CostModelScenarioFormData) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    // Convert percentage input (e.g., "18.3") to decimal (0.183)
    const value = parseFloat(e.target.value) / 100;
    if (!isNaN(value) && value >= 0 && value <= 1) {
      onChange({ [field]: value });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assumptions</CardTitle>
      </CardHeader>
      <CardContent>
        <TooltipProvider>
          <Accordion type="multiple" defaultValue={compact ? [] : ['sales', 'fees', 'cog', 'fixed', 'vat', 'tax']}>
            {/* Sales Volume Section - F9 */}
            <AccordionItem value="sales">
              <AccordionTrigger>Sales Volume & Pricing</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                  {/* BrickLink */}
                  <div className="space-y-4">
                    <h4 className="font-medium text-sm text-muted-foreground">BrickLink</h4>
                    <InputWithLabel
                      id="bl-sales"
                      label="Sales per Month"
                      value={data.blSalesPerMonth}
                      onChange={handleNumberChange('blSalesPerMonth')}
                      type="number"
                      min={0}
                      disabled={disabled}
                    />
                    <InputWithLabel
                      id="bl-avg-value"
                      label="Avg Sale Value"
                      value={data.blAvgSaleValue}
                      onChange={handleNumberChange('blAvgSaleValue')}
                      type="number"
                      min={0}
                      step={0.01}
                      prefix="£"
                      disabled={disabled}
                    />
                    <InputWithLabel
                      id="bl-postage"
                      label="Avg Postage Cost"
                      value={data.blAvgPostageCost}
                      onChange={handleNumberChange('blAvgPostageCost')}
                      type="number"
                      min={0}
                      step={0.01}
                      prefix="£"
                      disabled={disabled}
                    />
                  </div>

                  {/* Amazon */}
                  <div className="space-y-4">
                    <h4 className="font-medium text-sm text-muted-foreground">Amazon</h4>
                    <InputWithLabel
                      id="amazon-sales"
                      label="Sales per Month"
                      value={data.amazonSalesPerMonth}
                      onChange={handleNumberChange('amazonSalesPerMonth')}
                      type="number"
                      min={0}
                      disabled={disabled}
                    />
                    <InputWithLabel
                      id="amazon-avg-value"
                      label="Avg Sale Value"
                      value={data.amazonAvgSaleValue}
                      onChange={handleNumberChange('amazonAvgSaleValue')}
                      type="number"
                      min={0}
                      step={0.01}
                      prefix="£"
                      disabled={disabled}
                    />
                    <InputWithLabel
                      id="amazon-postage"
                      label="Avg Postage Cost"
                      value={data.amazonAvgPostageCost}
                      onChange={handleNumberChange('amazonAvgPostageCost')}
                      type="number"
                      min={0}
                      step={0.01}
                      prefix="£"
                      disabled={disabled}
                    />
                  </div>

                  {/* eBay */}
                  <div className="space-y-4">
                    <h4 className="font-medium text-sm text-muted-foreground">eBay</h4>
                    <InputWithLabel
                      id="ebay-sales"
                      label="Sales per Month"
                      value={data.ebaySalesPerMonth}
                      onChange={handleNumberChange('ebaySalesPerMonth')}
                      type="number"
                      min={0}
                      disabled={disabled}
                    />
                    <InputWithLabel
                      id="ebay-avg-value"
                      label="Avg Sale Value"
                      value={data.ebayAvgSaleValue}
                      onChange={handleNumberChange('ebayAvgSaleValue')}
                      type="number"
                      min={0}
                      step={0.01}
                      prefix="£"
                      disabled={disabled}
                    />
                    <InputWithLabel
                      id="ebay-postage"
                      label="Avg Postage Cost"
                      value={data.ebayAvgPostageCost}
                      onChange={handleNumberChange('ebayAvgPostageCost')}
                      type="number"
                      min={0}
                      step={0.01}
                      prefix="£"
                      disabled={disabled}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Fee Rates Section - F10 */}
            <AccordionItem value="fees">
              <AccordionTrigger>Platform Fee Rates</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                  <InputWithLabel
                    id="bl-fee"
                    label="BrickLink Fee Rate"
                    value={(data.blFeeRate * 100).toFixed(1)}
                    onChange={handlePercentChange('blFeeRate')}
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    suffix="%"
                    tooltip="Platform fee as a percentage of sale value"
                    disabled={disabled}
                  />
                  <InputWithLabel
                    id="amazon-fee"
                    label="Amazon Fee Rate"
                    value={(data.amazonFeeRate * 100).toFixed(1)}
                    onChange={handlePercentChange('amazonFeeRate')}
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    suffix="%"
                    tooltip="Includes referral fees and FBA fees"
                    disabled={disabled}
                  />
                  <InputWithLabel
                    id="ebay-fee"
                    label="eBay Fee Rate"
                    value={(data.ebayFeeRate * 100).toFixed(1)}
                    onChange={handlePercentChange('ebayFeeRate')}
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    suffix="%"
                    tooltip="Includes final value fee and payment processing"
                    disabled={disabled}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* COG Percentages Section - F11 */}
            <AccordionItem value="cog">
              <AccordionTrigger>Cost of Goods (COG)</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                  <InputWithLabel
                    id="bl-cog"
                    label="BrickLink COG %"
                    value={(data.blCogPercent * 100).toFixed(0)}
                    onChange={handlePercentChange('blCogPercent')}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    tooltip="Cost of goods as percentage of sale value"
                    disabled={disabled}
                  />
                  <InputWithLabel
                    id="amazon-cog"
                    label="Amazon COG %"
                    value={(data.amazonCogPercent * 100).toFixed(0)}
                    onChange={handlePercentChange('amazonCogPercent')}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    tooltip="Cost of goods as percentage of sale value"
                    disabled={disabled}
                  />
                  <InputWithLabel
                    id="ebay-cog"
                    label="eBay COG %"
                    value={(data.ebayCogPercent * 100).toFixed(0)}
                    onChange={handlePercentChange('ebayCogPercent')}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    tooltip="Cost of goods as percentage of sale value"
                    disabled={disabled}
                  />
                </div>
                <div className="mt-4">
                  <InputWithLabel
                    id="lego-parts"
                    label="Lego Parts % (eBay)"
                    value={(data.legoPartsPercent * 100).toFixed(1)}
                    onChange={handlePercentChange('legoPartsPercent')}
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    suffix="%"
                    tooltip="Percentage of eBay turnover spent on Lego parts"
                    disabled={disabled}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Fixed Costs Section - F12 */}
            <AccordionItem value="fixed">
              <AccordionTrigger>Fixed Costs</AccordionTrigger>
              <AccordionContent>
                <div className="pt-4">
                  <h4 className="font-medium text-sm text-muted-foreground mb-4">Monthly</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    <InputWithLabel
                      id="fixed-shopify"
                      label="Shopify"
                      value={data.fixedShopify}
                      onChange={handleNumberChange('fixedShopify')}
                      type="number"
                      min={0}
                      step={0.01}
                      prefix="£"
                      disabled={disabled}
                    />
                    <InputWithLabel
                      id="fixed-ebay"
                      label="eBay Store"
                      value={data.fixedEbayStore}
                      onChange={handleNumberChange('fixedEbayStore')}
                      type="number"
                      min={0}
                      step={0.01}
                      prefix="£"
                      disabled={disabled}
                    />
                    <InputWithLabel
                      id="fixed-tools"
                      label="Seller Tools"
                      value={data.fixedSellerTools}
                      onChange={handleNumberChange('fixedSellerTools')}
                      type="number"
                      min={0}
                      step={0.01}
                      prefix="£"
                      disabled={disabled}
                    />
                    <InputWithLabel
                      id="fixed-amazon"
                      label="Amazon"
                      value={data.fixedAmazon}
                      onChange={handleNumberChange('fixedAmazon')}
                      type="number"
                      min={0}
                      step={0.01}
                      prefix="£"
                      disabled={disabled}
                    />
                    <InputWithLabel
                      id="fixed-storage"
                      label="Storage"
                      value={data.fixedStorage}
                      onChange={handleNumberChange('fixedStorage')}
                      type="number"
                      min={0}
                      step={0.01}
                      prefix="£"
                      disabled={disabled}
                    />
                  </div>

                  <h4 className="font-medium text-sm text-muted-foreground mt-6 mb-4">Annual</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InputWithLabel
                      id="annual-accountant"
                      label="Accountant"
                      value={data.annualAccountantCost}
                      onChange={handleNumberChange('annualAccountantCost')}
                      type="number"
                      min={0}
                      step={0.01}
                      prefix="£"
                      tooltip={data.isVatRegistered ? 'Will use VAT accountant cost when VAT registered' : undefined}
                      disabled={disabled}
                    />
                    <InputWithLabel
                      id="annual-misc"
                      label="Misc Costs"
                      value={data.annualMiscCosts}
                      onChange={handleNumberChange('annualMiscCosts')}
                      type="number"
                      min={0}
                      step={0.01}
                      prefix="£"
                      disabled={disabled}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* VAT Settings Section - F13 */}
            <AccordionItem value="vat">
              <AccordionTrigger>VAT Settings</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-4">
                  <div className="flex items-center gap-4">
                    <Switch
                      id="vat-registered"
                      checked={data.isVatRegistered}
                      onCheckedChange={(checked: boolean) => onChange({ isVatRegistered: checked })}
                      disabled={disabled}
                    />
                    <Label htmlFor="vat-registered">Over VAT threshold</Label>
                  </div>

                  {data.isVatRegistered && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <InputWithLabel
                        id="vat-rate"
                        label="VAT Flat Rate"
                        value={(data.vatFlatRate * 100).toFixed(1)}
                        onChange={handlePercentChange('vatFlatRate')}
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        suffix="%"
                        tooltip="Flat Rate VAT Scheme percentage"
                        disabled={disabled}
                      />
                      <InputWithLabel
                        id="accountant-vat"
                        label="Accountant Cost (VAT)"
                        value={data.accountantCostIfVat}
                        onChange={handleNumberChange('accountantCostIfVat')}
                        type="number"
                        min={0}
                        step={0.01}
                        prefix="£"
                        tooltip="Annual accountant cost when VAT registered"
                        disabled={disabled}
                      />
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Tax Settings Section - F14 */}
            <AccordionItem value="tax">
              <AccordionTrigger>Tax Settings</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
                  <InputWithLabel
                    id="target-profit"
                    label="Target Annual Profit"
                    value={data.targetAnnualProfit}
                    onChange={handleNumberChange('targetAnnualProfit')}
                    type="number"
                    min={0}
                    step={100}
                    prefix="£"
                    tooltip="Your target profit for comparison"
                    disabled={disabled}
                  />
                  <InputWithLabel
                    id="personal-allowance"
                    label="Personal Allowance"
                    value={data.personalAllowance}
                    onChange={handleNumberChange('personalAllowance')}
                    type="number"
                    min={0}
                    step={1}
                    prefix="£"
                    tooltip="Tax-free income allowance"
                    disabled={disabled}
                  />
                  <InputWithLabel
                    id="income-tax"
                    label="Income Tax Rate"
                    value={(data.incomeTaxRate * 100).toFixed(0)}
                    onChange={handlePercentChange('incomeTaxRate')}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    tooltip="Basic rate income tax"
                    disabled={disabled}
                  />
                  <InputWithLabel
                    id="ni-rate"
                    label="NI Rate"
                    value={(data.niRate * 100).toFixed(0)}
                    onChange={handlePercentChange('niRate')}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    tooltip="National Insurance rate"
                    disabled={disabled}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}

/**
 * Input with label component
 * U4: Each input has visible label; complex inputs have tooltips
 */
interface InputWithLabelProps {
  id: string;
  label: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  tooltip?: string;
  disabled?: boolean;
}

function InputWithLabel({
  id,
  label,
  value,
  onChange,
  type = 'text',
  min,
  max,
  step,
  prefix,
  suffix,
  tooltip,
  disabled,
}: InputWithLabelProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs">{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
            {prefix}
          </span>
        )}
        <Input
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className={`${prefix ? 'pl-7' : ''} ${suffix ? 'pr-8' : ''}`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
