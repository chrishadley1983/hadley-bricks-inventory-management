/**
 * Database types for Hadley Bricks Inventory System
 * These types are derived from the Supabase schema
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          business_name: string | null;
          home_postcode: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          business_name?: string | null;
          home_postcode?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_name?: string | null;
          home_postcode?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      inventory_items: {
        Row: {
          id: string;
          user_id: string;
          set_number: string;
          item_name: string | null;
          condition: 'New' | 'Used' | null;
          status: string;
          source: string | null;
          purchase_date: string | null;
          cost: number | null;
          listing_date: string | null;
          listing_value: number | null;
          storage_location: string | null;
          sku: string | null;
          linked_lot: string | null;
          amazon_asin: string | null;
          listing_platform: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          set_number: string;
          item_name?: string | null;
          condition?: 'New' | 'Used' | null;
          status?: string;
          source?: string | null;
          purchase_date?: string | null;
          cost?: number | null;
          listing_date?: string | null;
          listing_value?: number | null;
          storage_location?: string | null;
          sku?: string | null;
          linked_lot?: string | null;
          amazon_asin?: string | null;
          listing_platform?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          set_number?: string;
          item_name?: string | null;
          condition?: 'New' | 'Used' | null;
          status?: string;
          source?: string | null;
          purchase_date?: string | null;
          cost?: number | null;
          listing_date?: string | null;
          listing_value?: number | null;
          storage_location?: string | null;
          sku?: string | null;
          linked_lot?: string | null;
          amazon_asin?: string | null;
          listing_platform?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      purchases: {
        Row: {
          id: string;
          user_id: string;
          purchase_date: string;
          short_description: string;
          cost: number;
          source: string | null;
          payment_method: string | null;
          description: string | null;
          reference: string | null;
          image_url: string | null;
          mileage: number | null;
          collection_address: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          purchase_date: string;
          short_description: string;
          cost: number;
          source?: string | null;
          payment_method?: string | null;
          description?: string | null;
          reference?: string | null;
          image_url?: string | null;
          mileage?: number | null;
          collection_address?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          purchase_date?: string;
          short_description?: string;
          cost?: number;
          source?: string | null;
          payment_method?: string | null;
          description?: string | null;
          reference?: string | null;
          image_url?: string | null;
          mileage?: number | null;
          collection_address?: string | null;
          created_at?: string;
        };
      };
      platform_credentials: {
        Row: {
          id: string;
          user_id: string;
          platform: string;
          credentials_encrypted: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          platform: string;
          credentials_encrypted: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          platform?: string;
          credentials_encrypted?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      platform_orders: {
        Row: {
          id: string;
          user_id: string;
          platform: string;
          platform_order_id: string;
          order_date: string | null;
          buyer_name: string | null;
          buyer_email: string | null;
          status: string | null;
          subtotal: number | null;
          shipping: number | null;
          fees: number | null;
          total: number | null;
          currency: string;
          shipping_address: Json | null;
          tracking_number: string | null;
          items_count: number;
          raw_data: Json | null;
          synced_at: string;
          internal_status: string | null;
          packed_at: string | null;
          shipped_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          shipping_carrier: string | null;
          shipping_method: string | null;
          shipping_cost_actual: number | null;
          notes: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          platform: string;
          platform_order_id: string;
          order_date?: string | null;
          buyer_name?: string | null;
          buyer_email?: string | null;
          status?: string | null;
          subtotal?: number | null;
          shipping?: number | null;
          fees?: number | null;
          total?: number | null;
          currency?: string;
          shipping_address?: Json | null;
          tracking_number?: string | null;
          items_count?: number;
          raw_data?: Json | null;
          synced_at?: string;
          internal_status?: string | null;
          packed_at?: string | null;
          shipped_at?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          shipping_carrier?: string | null;
          shipping_method?: string | null;
          shipping_cost_actual?: number | null;
          notes?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          platform?: string;
          platform_order_id?: string;
          order_date?: string | null;
          buyer_name?: string | null;
          buyer_email?: string | null;
          status?: string | null;
          subtotal?: number | null;
          shipping?: number | null;
          fees?: number | null;
          total?: number | null;
          currency?: string;
          shipping_address?: Json | null;
          tracking_number?: string | null;
          items_count?: number;
          raw_data?: Json | null;
          synced_at?: string;
          internal_status?: string | null;
          packed_at?: string | null;
          shipped_at?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          shipping_carrier?: string | null;
          shipping_method?: string | null;
          shipping_cost_actual?: number | null;
          notes?: string | null;
        };
      };
      financial_transactions: {
        Row: {
          id: string;
          user_id: string;
          transaction_date: string;
          type: 'sale' | 'fee' | 'refund' | 'payout';
          platform: string | null;
          order_id: string | null;
          amount: number;
          description: string | null;
          raw_data: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          transaction_date: string;
          type: 'sale' | 'fee' | 'refund' | 'payout';
          platform?: string | null;
          order_id?: string | null;
          amount: number;
          description?: string | null;
          raw_data?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          transaction_date?: string;
          type?: 'sale' | 'fee' | 'refund' | 'payout';
          platform?: string | null;
          order_id?: string | null;
          amount?: number;
          description?: string | null;
          raw_data?: Json | null;
          created_at?: string;
        };
      };
      user_settings: {
        Row: {
          id: string;
          user_id: string;
          source_options: string[];
          payment_methods: string[];
          google_sheets_config: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_options?: string[];
          payment_methods?: string[];
          google_sheets_config?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          source_options?: string[];
          payment_methods?: string[];
          google_sheets_config?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          item_number: string;
          item_name: string | null;
          item_type: string | null;
          color_id: number | null;
          color_name: string | null;
          quantity: number;
          condition: 'New' | 'Used' | null;
          unit_price: number | null;
          total_price: number | null;
          currency: string;
          inventory_item_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          item_number: string;
          item_name?: string | null;
          item_type?: string | null;
          color_id?: number | null;
          color_name?: string | null;
          quantity?: number;
          condition?: 'New' | 'Used' | null;
          unit_price?: number | null;
          total_price?: number | null;
          currency?: string;
          inventory_item_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          item_number?: string;
          item_name?: string | null;
          item_type?: string | null;
          color_id?: number | null;
          color_name?: string | null;
          quantity?: number;
          condition?: 'New' | 'Used' | null;
          unit_price?: number | null;
          total_price?: number | null;
          currency?: string;
          inventory_item_id?: string | null;
          created_at?: string;
        };
      };
      order_status_history: {
        Row: {
          id: string;
          order_id: string;
          status: string;
          previous_status: string | null;
          changed_by: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          status: string;
          previous_status?: string | null;
          changed_by?: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          status?: string;
          previous_status?: string | null;
          changed_by?: string;
          notes?: string | null;
          created_at?: string;
        };
      };
      sales: {
        Row: {
          id: string;
          user_id: string;
          order_id: string | null;
          sale_date: string;
          platform: string | null;
          platform_order_id: string | null;
          sale_amount: number;
          shipping_charged: number;
          shipping_cost: number;
          platform_fees: number;
          other_costs: number;
          net_revenue: number;
          cost_of_goods: number;
          shipping_expense: number;
          gross_profit: number;
          buyer_name: string | null;
          buyer_email: string | null;
          description: string | null;
          notes: string | null;
          currency: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          order_id?: string | null;
          sale_date: string;
          platform?: string | null;
          platform_order_id?: string | null;
          sale_amount: number;
          shipping_charged?: number;
          shipping_cost?: number;
          platform_fees?: number;
          other_costs?: number;
          cost_of_goods?: number;
          shipping_expense?: number;
          buyer_name?: string | null;
          buyer_email?: string | null;
          description?: string | null;
          notes?: string | null;
          currency?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          order_id?: string | null;
          sale_date?: string;
          platform?: string | null;
          platform_order_id?: string | null;
          sale_amount?: number;
          shipping_charged?: number;
          shipping_cost?: number;
          platform_fees?: number;
          other_costs?: number;
          cost_of_goods?: number;
          shipping_expense?: number;
          buyer_name?: string | null;
          buyer_email?: string | null;
          description?: string | null;
          notes?: string | null;
          currency?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      sale_items: {
        Row: {
          id: string;
          sale_id: string;
          item_number: string;
          item_name: string | null;
          item_type: string | null;
          color_name: string | null;
          condition: 'New' | 'Used' | null;
          quantity: number;
          unit_price: number;
          total_price: number;
          unit_cost: number | null;
          inventory_item_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          sale_id: string;
          item_number: string;
          item_name?: string | null;
          item_type?: string | null;
          color_name?: string | null;
          condition?: 'New' | 'Used' | null;
          quantity?: number;
          unit_price: number;
          total_price: number;
          unit_cost?: number | null;
          inventory_item_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          sale_id?: string;
          item_number?: string;
          item_name?: string | null;
          item_type?: string | null;
          color_name?: string | null;
          condition?: 'New' | 'Used' | null;
          quantity?: number;
          unit_price?: number;
          total_price?: number;
          unit_cost?: number | null;
          inventory_item_id?: string | null;
          created_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

// Convenience type aliases
export type Profile = Database['public']['Tables']['profiles']['Row'];
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

export type InventoryItem = Database['public']['Tables']['inventory_items']['Row'];
export type InventoryItemInsert = Database['public']['Tables']['inventory_items']['Insert'];
export type InventoryItemUpdate = Database['public']['Tables']['inventory_items']['Update'];

export type Purchase = Database['public']['Tables']['purchases']['Row'];
export type PurchaseInsert = Database['public']['Tables']['purchases']['Insert'];
export type PurchaseUpdate = Database['public']['Tables']['purchases']['Update'];

export type PlatformCredential = Database['public']['Tables']['platform_credentials']['Row'];
export type PlatformCredentialInsert = Database['public']['Tables']['platform_credentials']['Insert'];
export type PlatformCredentialUpdate = Database['public']['Tables']['platform_credentials']['Update'];

export type PlatformOrder = Database['public']['Tables']['platform_orders']['Row'];
export type PlatformOrderInsert = Database['public']['Tables']['platform_orders']['Insert'];
export type PlatformOrderUpdate = Database['public']['Tables']['platform_orders']['Update'];

export type FinancialTransaction = Database['public']['Tables']['financial_transactions']['Row'];
export type FinancialTransactionInsert =
  Database['public']['Tables']['financial_transactions']['Insert'];
export type FinancialTransactionUpdate =
  Database['public']['Tables']['financial_transactions']['Update'];

export type UserSettings = Database['public']['Tables']['user_settings']['Row'];
export type UserSettingsInsert = Database['public']['Tables']['user_settings']['Insert'];
export type UserSettingsUpdate = Database['public']['Tables']['user_settings']['Update'];

export type OrderItem = Database['public']['Tables']['order_items']['Row'];
export type OrderItemInsert = Database['public']['Tables']['order_items']['Insert'];
export type OrderItemUpdate = Database['public']['Tables']['order_items']['Update'];

export type OrderStatusHistory = Database['public']['Tables']['order_status_history']['Row'];
export type OrderStatusHistoryInsert = Database['public']['Tables']['order_status_history']['Insert'];
export type OrderStatusHistoryUpdate = Database['public']['Tables']['order_status_history']['Update'];

export type Sale = Database['public']['Tables']['sales']['Row'];
export type SaleInsert = Database['public']['Tables']['sales']['Insert'];
export type SaleUpdate = Database['public']['Tables']['sales']['Update'];

export type SaleItem = Database['public']['Tables']['sale_items']['Row'];
export type SaleItemInsert = Database['public']['Tables']['sale_items']['Insert'];
export type SaleItemUpdate = Database['public']['Tables']['sale_items']['Update'];

// Inventory status enum-like type
export type InventoryStatus = 'NOT YET RECEIVED' | 'IN STOCK' | 'LISTED' | 'SOLD';

// Platform types
export type Platform = 'bricklink' | 'brickowl' | 'bricqer' | 'ebay' | 'amazon';

// Transaction types
export type TransactionType = 'sale' | 'fee' | 'refund' | 'payout';

// Item condition
export type ItemCondition = 'New' | 'Used';

// Order status workflow
export type OrderStatus = 'Pending' | 'Paid' | 'Packed' | 'Shipped' | 'Completed' | 'Cancelled';
