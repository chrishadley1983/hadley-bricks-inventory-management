/**
 * Cost Modelling Repository
 * Data access layer for cost model scenarios and package costs
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  CostModelScenario,
  PackageCost,
  CostModelScenarioFormData,
  PackageCostFormData,
  ScenarioListItem,
} from '@/types/cost-modelling';

/**
 * Convert database record to form data
 */
export function scenarioToFormData(scenario: CostModelScenario): CostModelScenarioFormData {
  return {
    name: scenario.name,
    description: scenario.description || '',
    blSalesPerMonth: scenario.bl_sales_per_month,
    blAvgSaleValue: Number(scenario.bl_avg_sale_value),
    blAvgPostageCost: Number(scenario.bl_avg_postage_cost),
    amazonSalesPerMonth: scenario.amazon_sales_per_month,
    amazonAvgSaleValue: Number(scenario.amazon_avg_sale_value),
    amazonAvgPostageCost: Number(scenario.amazon_avg_postage_cost),
    ebaySalesPerMonth: scenario.ebay_sales_per_month,
    ebayAvgSaleValue: Number(scenario.ebay_avg_sale_value),
    ebayAvgPostageCost: Number(scenario.ebay_avg_postage_cost),
    blFeeRate: Number(scenario.bl_fee_rate),
    amazonFeeRate: Number(scenario.amazon_fee_rate),
    ebayFeeRate: Number(scenario.ebay_fee_rate),
    blCogPercent: Number(scenario.bl_cog_percent),
    amazonCogPercent: Number(scenario.amazon_cog_percent),
    ebayCogPercent: Number(scenario.ebay_cog_percent),
    fixedShopify: Number(scenario.fixed_shopify),
    fixedEbayStore: Number(scenario.fixed_ebay_store),
    fixedSellerTools: Number(scenario.fixed_seller_tools),
    fixedAmazon: Number(scenario.fixed_amazon),
    fixedStorage: Number(scenario.fixed_storage),
    annualAccountantCost: Number(scenario.annual_accountant_cost),
    annualMiscCosts: Number(scenario.annual_misc_costs),
    isVatRegistered: scenario.is_vat_registered,
    vatFlatRate: Number(scenario.vat_flat_rate),
    accountantCostIfVat: Number(scenario.accountant_cost_if_vat),
    targetAnnualProfit: Number(scenario.target_annual_profit),
    personalAllowance: Number(scenario.personal_allowance),
    incomeTaxRate: Number(scenario.income_tax_rate),
    niRate: Number(scenario.ni_rate),
    legoPartsPercent: Number(scenario.lego_parts_percent),
    packageCosts: scenario.package_costs?.map(packageCostToFormData),
  };
}

/**
 * Convert package cost record to form data
 */
export function packageCostToFormData(cost: PackageCost): PackageCostFormData {
  return {
    id: cost.id,
    packageType: cost.package_type,
    postage: Number(cost.postage),
    cardboard: Number(cost.cardboard),
    bubbleWrap: Number(cost.bubble_wrap),
    legoCard: Number(cost.lego_card),
    businessCard: Number(cost.business_card),
  };
}

/**
 * Convert form data to database insert/update format
 */
export function formDataToScenario(
  formData: CostModelScenarioFormData,
  userId: string
): Omit<CostModelScenario, 'id' | 'created_at' | 'updated_at' | 'draft_data' | 'draft_updated_at' | 'package_costs'> {
  return {
    user_id: userId,
    name: formData.name,
    description: formData.description || null,
    bl_sales_per_month: formData.blSalesPerMonth,
    bl_avg_sale_value: formData.blAvgSaleValue,
    bl_avg_postage_cost: formData.blAvgPostageCost,
    amazon_sales_per_month: formData.amazonSalesPerMonth,
    amazon_avg_sale_value: formData.amazonAvgSaleValue,
    amazon_avg_postage_cost: formData.amazonAvgPostageCost,
    ebay_sales_per_month: formData.ebaySalesPerMonth,
    ebay_avg_sale_value: formData.ebayAvgSaleValue,
    ebay_avg_postage_cost: formData.ebayAvgPostageCost,
    bl_fee_rate: formData.blFeeRate,
    amazon_fee_rate: formData.amazonFeeRate,
    ebay_fee_rate: formData.ebayFeeRate,
    bl_cog_percent: formData.blCogPercent,
    amazon_cog_percent: formData.amazonCogPercent,
    ebay_cog_percent: formData.ebayCogPercent,
    fixed_shopify: formData.fixedShopify,
    fixed_ebay_store: formData.fixedEbayStore,
    fixed_seller_tools: formData.fixedSellerTools,
    fixed_amazon: formData.fixedAmazon,
    fixed_storage: formData.fixedStorage,
    annual_accountant_cost: formData.annualAccountantCost,
    annual_misc_costs: formData.annualMiscCosts,
    is_vat_registered: formData.isVatRegistered,
    vat_flat_rate: formData.vatFlatRate,
    accountant_cost_if_vat: formData.accountantCostIfVat,
    target_annual_profit: formData.targetAnnualProfit,
    personal_allowance: formData.personalAllowance,
    income_tax_rate: formData.incomeTaxRate,
    ni_rate: formData.niRate,
    lego_parts_percent: formData.legoPartsPercent,
    is_default: false,
  };
}

export class CostModellingRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get all scenarios for a user (for dropdown)
   * P3: Should complete in under 500ms
   */
  async findAllByUser(userId: string): Promise<ScenarioListItem[]> {
    const { data, error } = await this.supabase
      .from('cost_model_scenarios')
      .select('id, name, updated_at, is_default')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch scenarios: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get a single scenario by ID with package costs
   */
  async findById(id: string): Promise<CostModelScenario | null> {
    const { data, error } = await this.supabase
      .from('cost_model_scenarios')
      .select('*, package_costs:cost_model_package_costs(*)')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw new Error(`Failed to fetch scenario: ${error.message}`);
    }

    return data as CostModelScenario;
  }

  /**
   * Create a new scenario with default package costs
   * F3: Returns 201 with scenario ID
   */
  async create(
    userId: string,
    data: { name: string; description?: string }
  ): Promise<CostModelScenario> {
    const { data: scenario, error } = await this.supabase
      .from('cost_model_scenarios')
      .insert({
        user_id: userId,
        name: data.name,
        description: data.description || null,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create scenario: ${error.message}`);
    }

    // Create default package costs
    await this.createDefaultPackageCosts(scenario.id);

    return scenario as CostModelScenario;
  }

  /**
   * Create default scenario for first-time users
   * F8: Auto-create when user has no scenarios
   */
  async createDefault(userId: string): Promise<CostModelScenario> {
    const { data: scenario, error } = await this.supabase
      .from('cost_model_scenarios')
      .insert({
        user_id: userId,
        name: 'Default Scenario',
        description: 'Your first cost modelling scenario',
        is_default: true,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create default scenario: ${error.message}`);
    }

    // Create default package costs
    await this.createDefaultPackageCosts(scenario.id);

    return scenario as CostModelScenario;
  }

  /**
   * Create default package costs for a scenario
   * F26: Seeded with spec default values
   */
  async createDefaultPackageCosts(scenarioId: string): Promise<void> {
    const defaultCosts = [
      {
        scenario_id: scenarioId,
        package_type: 'large_parcel_amazon',
        postage: 3.95,
        cardboard: 0.50,
        bubble_wrap: 0.30,
        lego_card: 0.00,
        business_card: 0.00,
      },
      {
        scenario_id: scenarioId,
        package_type: 'small_parcel_amazon',
        postage: 3.35,
        cardboard: 0.30,
        bubble_wrap: 0.20,
        lego_card: 0.00,
        business_card: 0.00,
      },
      {
        scenario_id: scenarioId,
        package_type: 'large_letter_amazon',
        postage: 1.55,
        cardboard: 0.15,
        bubble_wrap: 0.10,
        lego_card: 0.00,
        business_card: 0.00,
      },
      {
        scenario_id: scenarioId,
        package_type: 'large_parcel_ebay',
        postage: 3.95,
        cardboard: 0.50,
        bubble_wrap: 0.30,
        lego_card: 0.10,
        business_card: 0.05,
      },
      {
        scenario_id: scenarioId,
        package_type: 'small_parcel_ebay',
        postage: 3.35,
        cardboard: 0.30,
        bubble_wrap: 0.20,
        lego_card: 0.10,
        business_card: 0.05,
      },
      {
        scenario_id: scenarioId,
        package_type: 'large_letter_ebay',
        postage: 1.55,
        cardboard: 0.15,
        bubble_wrap: 0.10,
        lego_card: 0.10,
        business_card: 0.05,
      },
    ];

    const { error } = await this.supabase
      .from('cost_model_package_costs')
      .insert(defaultCosts);

    if (error) {
      throw new Error(`Failed to create package costs: ${error.message}`);
    }
  }

  /**
   * Update a scenario
   * F5: PUT returns 200
   */
  async update(
    id: string,
    formData: Partial<CostModelScenarioFormData>,
    userId: string
  ): Promise<CostModelScenario> {
    // Convert form data to database format
    const updateData: Record<string, unknown> = {};

    if (formData.name !== undefined) updateData.name = formData.name;
    if (formData.description !== undefined) updateData.description = formData.description;
    if (formData.blSalesPerMonth !== undefined) updateData.bl_sales_per_month = formData.blSalesPerMonth;
    if (formData.blAvgSaleValue !== undefined) updateData.bl_avg_sale_value = formData.blAvgSaleValue;
    if (formData.blAvgPostageCost !== undefined) updateData.bl_avg_postage_cost = formData.blAvgPostageCost;
    if (formData.amazonSalesPerMonth !== undefined) updateData.amazon_sales_per_month = formData.amazonSalesPerMonth;
    if (formData.amazonAvgSaleValue !== undefined) updateData.amazon_avg_sale_value = formData.amazonAvgSaleValue;
    if (formData.amazonAvgPostageCost !== undefined) updateData.amazon_avg_postage_cost = formData.amazonAvgPostageCost;
    if (formData.ebaySalesPerMonth !== undefined) updateData.ebay_sales_per_month = formData.ebaySalesPerMonth;
    if (formData.ebayAvgSaleValue !== undefined) updateData.ebay_avg_sale_value = formData.ebayAvgSaleValue;
    if (formData.ebayAvgPostageCost !== undefined) updateData.ebay_avg_postage_cost = formData.ebayAvgPostageCost;
    if (formData.blFeeRate !== undefined) updateData.bl_fee_rate = formData.blFeeRate;
    if (formData.amazonFeeRate !== undefined) updateData.amazon_fee_rate = formData.amazonFeeRate;
    if (formData.ebayFeeRate !== undefined) updateData.ebay_fee_rate = formData.ebayFeeRate;
    if (formData.blCogPercent !== undefined) updateData.bl_cog_percent = formData.blCogPercent;
    if (formData.amazonCogPercent !== undefined) updateData.amazon_cog_percent = formData.amazonCogPercent;
    if (formData.ebayCogPercent !== undefined) updateData.ebay_cog_percent = formData.ebayCogPercent;
    if (formData.fixedShopify !== undefined) updateData.fixed_shopify = formData.fixedShopify;
    if (formData.fixedEbayStore !== undefined) updateData.fixed_ebay_store = formData.fixedEbayStore;
    if (formData.fixedSellerTools !== undefined) updateData.fixed_seller_tools = formData.fixedSellerTools;
    if (formData.fixedAmazon !== undefined) updateData.fixed_amazon = formData.fixedAmazon;
    if (formData.fixedStorage !== undefined) updateData.fixed_storage = formData.fixedStorage;
    if (formData.annualAccountantCost !== undefined) updateData.annual_accountant_cost = formData.annualAccountantCost;
    if (formData.annualMiscCosts !== undefined) updateData.annual_misc_costs = formData.annualMiscCosts;
    if (formData.isVatRegistered !== undefined) updateData.is_vat_registered = formData.isVatRegistered;
    if (formData.vatFlatRate !== undefined) updateData.vat_flat_rate = formData.vatFlatRate;
    if (formData.accountantCostIfVat !== undefined) updateData.accountant_cost_if_vat = formData.accountantCostIfVat;
    if (formData.targetAnnualProfit !== undefined) updateData.target_annual_profit = formData.targetAnnualProfit;
    if (formData.personalAllowance !== undefined) updateData.personal_allowance = formData.personalAllowance;
    if (formData.incomeTaxRate !== undefined) updateData.income_tax_rate = formData.incomeTaxRate;
    if (formData.niRate !== undefined) updateData.ni_rate = formData.niRate;
    if (formData.legoPartsPercent !== undefined) updateData.lego_parts_percent = formData.legoPartsPercent;

    const { data, error } = await this.supabase
      .from('cost_model_scenarios')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update scenario: ${error.message}`);
    }

    // Update package costs if provided
    if (formData.packageCosts) {
      await this.updatePackageCosts(id, formData.packageCosts);
    }

    return data as CostModelScenario;
  }

  /**
   * Update package costs for a scenario
   * Uses upsert for batch update (single DB call instead of N calls)
   */
  async updatePackageCosts(
    scenarioId: string,
    costs: PackageCostFormData[]
  ): Promise<void> {
    const upsertData = costs.map((cost) => ({
      scenario_id: scenarioId,
      package_type: cost.packageType,
      postage: cost.postage,
      cardboard: cost.cardboard,
      bubble_wrap: cost.bubbleWrap,
      lego_card: cost.legoCard,
      business_card: cost.businessCard,
    }));

    const { error } = await this.supabase
      .from('cost_model_package_costs')
      .upsert(upsertData, { onConflict: 'scenario_id,package_type' });

    if (error) {
      throw new Error(`Failed to update package costs: ${error.message}`);
    }
  }

  /**
   * Delete a scenario
   * F7: DELETE returns 200
   */
  async delete(id: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('cost_model_scenarios')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to delete scenario: ${error.message}`);
    }
  }

  /**
   * Duplicate a scenario
   * F44: Creates copy with "Copy of [name]"
   */
  async duplicate(id: string, userId: string): Promise<CostModelScenario> {
    // Get original scenario
    const original = await this.findById(id);
    if (!original) {
      throw new Error('Scenario not found');
    }

    // Create copy
    const { data: copy, error } = await this.supabase
      .from('cost_model_scenarios')
      .insert({
        user_id: userId,
        name: `Copy of ${original.name}`,
        description: original.description,
        bl_sales_per_month: original.bl_sales_per_month,
        bl_avg_sale_value: original.bl_avg_sale_value,
        bl_avg_postage_cost: original.bl_avg_postage_cost,
        amazon_sales_per_month: original.amazon_sales_per_month,
        amazon_avg_sale_value: original.amazon_avg_sale_value,
        amazon_avg_postage_cost: original.amazon_avg_postage_cost,
        ebay_sales_per_month: original.ebay_sales_per_month,
        ebay_avg_sale_value: original.ebay_avg_sale_value,
        ebay_avg_postage_cost: original.ebay_avg_postage_cost,
        bl_fee_rate: original.bl_fee_rate,
        amazon_fee_rate: original.amazon_fee_rate,
        ebay_fee_rate: original.ebay_fee_rate,
        bl_cog_percent: original.bl_cog_percent,
        amazon_cog_percent: original.amazon_cog_percent,
        ebay_cog_percent: original.ebay_cog_percent,
        fixed_shopify: original.fixed_shopify,
        fixed_ebay_store: original.fixed_ebay_store,
        fixed_seller_tools: original.fixed_seller_tools,
        fixed_amazon: original.fixed_amazon,
        fixed_storage: original.fixed_storage,
        annual_accountant_cost: original.annual_accountant_cost,
        annual_misc_costs: original.annual_misc_costs,
        is_vat_registered: original.is_vat_registered,
        vat_flat_rate: original.vat_flat_rate,
        accountant_cost_if_vat: original.accountant_cost_if_vat,
        target_annual_profit: original.target_annual_profit,
        personal_allowance: original.personal_allowance,
        income_tax_rate: original.income_tax_rate,
        ni_rate: original.ni_rate,
        lego_parts_percent: original.lego_parts_percent,
        is_default: false,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to duplicate scenario: ${error.message}`);
    }

    // Copy package costs
    if (original.package_costs && original.package_costs.length > 0) {
      const packageCostsCopy = original.package_costs.map((cost) => ({
        scenario_id: copy.id,
        package_type: cost.package_type,
        postage: cost.postage,
        cardboard: cost.cardboard,
        bubble_wrap: cost.bubble_wrap,
        lego_card: cost.lego_card,
        business_card: cost.business_card,
      }));

      const { error: pkgError } = await this.supabase
        .from('cost_model_package_costs')
        .insert(packageCostsCopy);

      if (pkgError) {
        throw new Error(`Failed to copy package costs: ${pkgError.message}`);
      }
    } else {
      // Create default package costs if original had none
      await this.createDefaultPackageCosts(copy.id);
    }

    return copy as CostModelScenario;
  }

  /**
   * Save draft data for auto-save
   * F47: Auto-saved every 30 seconds
   */
  async saveDraft(
    id: string,
    userId: string,
    draftData: CostModelScenarioFormData
  ): Promise<void> {
    const { error } = await this.supabase
      .from('cost_model_scenarios')
      .update({
        draft_data: draftData,
        draft_updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to save draft: ${error.message}`);
    }
  }

  /**
   * Clear draft data after save
   */
  async clearDraft(id: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('cost_model_scenarios')
      .update({
        draft_data: null,
        draft_updated_at: null,
      })
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to clear draft: ${error.message}`);
    }
  }

  /**
   * Get scenario count for user (for delete prevention)
   * E5: Cannot delete last scenario
   */
  async getScenarioCount(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('cost_model_scenarios')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to count scenarios: ${error.message}`);
    }

    return count || 0;
  }

  /**
   * Check for concurrent edit conflict
   * E7: Compare updated_at for optimistic locking
   */
  async checkConflict(id: string, knownUpdatedAt: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('cost_model_scenarios')
      .select('updated_at')
      .eq('id', id)
      .single();

    if (error) {
      throw new Error(`Failed to check conflict: ${error.message}`);
    }

    return data.updated_at !== knownUpdatedAt;
  }
}
