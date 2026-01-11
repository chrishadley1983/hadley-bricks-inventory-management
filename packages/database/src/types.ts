export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      amazon_arbitrage_pricing: {
        Row: {
          asin: string
          buy_box_is_yours: boolean | null
          buy_box_price: number | null
          created_at: string
          id: string
          offer_count: number | null
          sales_rank: number | null
          sales_rank_category: string | null
          snapshot_date: string
          user_id: string
          was_price_90d: number | null
          your_price: number | null
          your_qty: number | null
        }
        Insert: {
          asin: string
          buy_box_is_yours?: boolean | null
          buy_box_price?: number | null
          created_at?: string
          id?: string
          offer_count?: number | null
          sales_rank?: number | null
          sales_rank_category?: string | null
          snapshot_date: string
          user_id: string
          was_price_90d?: number | null
          your_price?: number | null
          your_qty?: number | null
        }
        Update: {
          asin?: string
          buy_box_is_yours?: boolean | null
          buy_box_price?: number | null
          created_at?: string
          id?: string
          offer_count?: number | null
          sales_rank?: number | null
          sales_rank_category?: string | null
          snapshot_date?: string
          user_id?: string
          was_price_90d?: number | null
          your_price?: number | null
          your_qty?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "amazon_arbitrage_pricing_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      amazon_inventory_resolution_queue: {
        Row: {
          amazon_order_id: string
          asin: string | null
          created_at: string
          id: string
          item_name: string
          match_candidates: Json | null
          order_date: string
          order_item_id: string
          platform_order_id: string
          quantity: number
          quantity_needed: number | null
          resolution_reason: string
          resolved_at: string | null
          resolved_by: string | null
          resolved_inventory_item_ids: string[] | null
          status: string
          total_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          amazon_order_id: string
          asin?: string | null
          created_at?: string
          id?: string
          item_name: string
          match_candidates?: Json | null
          order_date: string
          order_item_id: string
          platform_order_id: string
          quantity?: number
          quantity_needed?: number | null
          resolution_reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_inventory_item_ids?: string[] | null
          status?: string
          total_amount: number
          updated_at?: string
          user_id: string
        }
        Update: {
          amazon_order_id?: string
          asin?: string | null
          created_at?: string
          id?: string
          item_name?: string
          match_candidates?: Json | null
          order_date?: string
          order_item_id?: string
          platform_order_id?: string
          quantity?: number
          quantity_needed?: number | null
          resolution_reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_inventory_item_ids?: string[] | null
          status?: string
          total_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amazon_inventory_resolution_queue_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: true
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amazon_inventory_resolution_queue_platform_order_id_fkey"
            columns: ["platform_order_id"]
            isOneToOne: false
            referencedRelation: "platform_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amazon_inventory_resolution_queue_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amazon_inventory_resolution_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      amazon_product_cache: {
        Row: {
          asin: string
          brand: string | null
          created_at: string
          fetched_at: string
          id: string
          marketplace_id: string
          product_type: string | null
          raw_response: Json | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          asin: string
          brand?: string | null
          created_at?: string
          fetched_at?: string
          id?: string
          marketplace_id?: string
          product_type?: string | null
          raw_response?: Json | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          asin?: string
          brand?: string | null
          created_at?: string
          fetched_at?: string
          id?: string
          marketplace_id?: string
          product_type?: string | null
          raw_response?: Json | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amazon_product_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      amazon_settlements: {
        Row: {
          account_tail: string | null
          beginning_balance: number | null
          created_at: string
          currency: string
          financial_event_group_id: string
          fund_transfer_date: string | null
          fund_transfer_status: string | null
          id: string
          processing_period_end: string | null
          processing_period_start: string | null
          raw_response: Json
          settlement_id: string | null
          total_amount: number
          trace_id: string | null
          transaction_count: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_tail?: string | null
          beginning_balance?: number | null
          created_at?: string
          currency: string
          financial_event_group_id: string
          fund_transfer_date?: string | null
          fund_transfer_status?: string | null
          id?: string
          processing_period_end?: string | null
          processing_period_start?: string | null
          raw_response: Json
          settlement_id?: string | null
          total_amount: number
          trace_id?: string | null
          transaction_count?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_tail?: string | null
          beginning_balance?: number | null
          created_at?: string
          currency?: string
          financial_event_group_id?: string
          fund_transfer_date?: string | null
          fund_transfer_status?: string | null
          id?: string
          processing_period_end?: string | null
          processing_period_start?: string | null
          raw_response?: Json
          settlement_id?: string | null
          total_amount?: number
          trace_id?: string | null
          transaction_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amazon_settlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      amazon_sync_config: {
        Row: {
          auto_sync_enabled: boolean
          auto_sync_interval_hours: number
          created_at: string
          historical_import_completed_at: string | null
          historical_import_from_date: string | null
          historical_import_started_at: string | null
          id: string
          last_auto_sync_at: string | null
          next_auto_sync_at: string | null
          settlements_cursor: string | null
          transactions_posted_cursor: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_sync_enabled?: boolean
          auto_sync_interval_hours?: number
          created_at?: string
          historical_import_completed_at?: string | null
          historical_import_from_date?: string | null
          historical_import_started_at?: string | null
          id?: string
          last_auto_sync_at?: string | null
          next_auto_sync_at?: string | null
          settlements_cursor?: string | null
          transactions_posted_cursor?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_sync_enabled?: boolean
          auto_sync_interval_hours?: number
          created_at?: string
          historical_import_completed_at?: string | null
          historical_import_from_date?: string | null
          historical_import_started_at?: string | null
          id?: string
          last_auto_sync_at?: string | null
          next_auto_sync_at?: string | null
          settlements_cursor?: string | null
          transactions_posted_cursor?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amazon_sync_config_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      amazon_sync_feed_items: {
        Row: {
          amazon_result_code: string | null
          amazon_sku: string
          amazon_status: string | null
          asin: string
          created_at: string
          error_code: string | null
          error_details: Json | null
          error_message: string | null
          feed_id: string
          id: string
          inventory_item_ids: string[]
          is_new_sku: boolean | null
          price_verified: boolean | null
          quantity_verified: boolean | null
          status: string
          submitted_price: number
          submitted_quantity: number
          updated_at: string
          user_id: string
          verification_error: string | null
          verified_price: number | null
          verified_quantity: number | null
          warnings: Json | null
        }
        Insert: {
          amazon_result_code?: string | null
          amazon_sku: string
          amazon_status?: string | null
          asin: string
          created_at?: string
          error_code?: string | null
          error_details?: Json | null
          error_message?: string | null
          feed_id: string
          id?: string
          inventory_item_ids?: string[]
          is_new_sku?: boolean | null
          price_verified?: boolean | null
          quantity_verified?: boolean | null
          status?: string
          submitted_price: number
          submitted_quantity: number
          updated_at?: string
          user_id: string
          verification_error?: string | null
          verified_price?: number | null
          verified_quantity?: number | null
          warnings?: Json | null
        }
        Update: {
          amazon_result_code?: string | null
          amazon_sku?: string
          amazon_status?: string | null
          asin?: string
          created_at?: string
          error_code?: string | null
          error_details?: Json | null
          error_message?: string | null
          feed_id?: string
          id?: string
          inventory_item_ids?: string[]
          is_new_sku?: boolean | null
          price_verified?: boolean | null
          quantity_verified?: boolean | null
          status?: string
          submitted_price?: number
          submitted_quantity?: number
          updated_at?: string
          user_id?: string
          verification_error?: string | null
          verified_price?: number | null
          verified_quantity?: number | null
          warnings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "amazon_sync_feed_items_feed_id_fkey"
            columns: ["feed_id"]
            isOneToOne: false
            referencedRelation: "amazon_sync_feeds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amazon_sync_feed_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      amazon_sync_feeds: {
        Row: {
          amazon_feed_document_id: string | null
          amazon_feed_id: string | null
          amazon_result_document_id: string | null
          completed_at: string | null
          created_at: string
          error_count: number | null
          error_details: Json | null
          error_message: string | null
          feed_type: string
          id: string
          is_dry_run: boolean
          last_poll_at: string | null
          last_verification_at: string | null
          marketplace_id: string
          poll_count: number | null
          request_payload: Json | null
          response_payload: Json | null
          result_payload: Json | null
          status: string
          submitted_at: string | null
          success_count: number | null
          total_items: number
          updated_at: string
          user_id: string
          verification_attempts: number | null
          verification_completed_at: string | null
          verification_started_at: string | null
          warning_count: number | null
        }
        Insert: {
          amazon_feed_document_id?: string | null
          amazon_feed_id?: string | null
          amazon_result_document_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_count?: number | null
          error_details?: Json | null
          error_message?: string | null
          feed_type?: string
          id?: string
          is_dry_run?: boolean
          last_poll_at?: string | null
          last_verification_at?: string | null
          marketplace_id?: string
          poll_count?: number | null
          request_payload?: Json | null
          response_payload?: Json | null
          result_payload?: Json | null
          status?: string
          submitted_at?: string | null
          success_count?: number | null
          total_items?: number
          updated_at?: string
          user_id: string
          verification_attempts?: number | null
          verification_completed_at?: string | null
          verification_started_at?: string | null
          warning_count?: number | null
        }
        Update: {
          amazon_feed_document_id?: string | null
          amazon_feed_id?: string | null
          amazon_result_document_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_count?: number | null
          error_details?: Json | null
          error_message?: string | null
          feed_type?: string
          id?: string
          is_dry_run?: boolean
          last_poll_at?: string | null
          last_verification_at?: string | null
          marketplace_id?: string
          poll_count?: number | null
          request_payload?: Json | null
          response_payload?: Json | null
          result_payload?: Json | null
          status?: string
          submitted_at?: string | null
          success_count?: number | null
          total_items?: number
          updated_at?: string
          user_id?: string
          verification_attempts?: number | null
          verification_completed_at?: string | null
          verification_started_at?: string | null
          warning_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "amazon_sync_feeds_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      amazon_sync_log: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          from_date: string | null
          id: string
          last_sync_cursor: string | null
          records_created: number | null
          records_processed: number | null
          records_updated: number | null
          started_at: string
          status: string
          sync_mode: string | null
          sync_type: string
          to_date: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          from_date?: string | null
          id?: string
          last_sync_cursor?: string | null
          records_created?: number | null
          records_processed?: number | null
          records_updated?: number | null
          started_at: string
          status: string
          sync_mode?: string | null
          sync_type: string
          to_date?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          from_date?: string | null
          id?: string
          last_sync_cursor?: string | null
          records_created?: number | null
          records_processed?: number | null
          records_updated?: number | null
          started_at?: string
          status?: string
          sync_mode?: string | null
          sync_type?: string
          to_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amazon_sync_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      amazon_sync_queue: {
        Row: {
          added_at: string
          amazon_price: number | null
          amazon_quantity: number | null
          amazon_sku: string | null
          asin: string
          created_at: string
          id: string
          inventory_item_id: string
          is_new_sku: boolean | null
          local_price: number
          local_quantity: number
          product_type: string | null
          sku: string
          updated_at: string
          user_id: string
        }
        Insert: {
          added_at?: string
          amazon_price?: number | null
          amazon_quantity?: number | null
          amazon_sku?: string | null
          asin: string
          created_at?: string
          id?: string
          inventory_item_id: string
          is_new_sku?: boolean | null
          local_price: number
          local_quantity?: number
          product_type?: string | null
          sku: string
          updated_at?: string
          user_id: string
        }
        Update: {
          added_at?: string
          amazon_price?: number | null
          amazon_quantity?: number | null
          amazon_sku?: string | null
          asin?: string
          created_at?: string
          id?: string
          inventory_item_id?: string
          is_new_sku?: boolean | null
          local_price?: number
          local_quantity?: number
          product_type?: string | null
          sku?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amazon_sync_queue_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amazon_sync_queue_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items_with_age"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amazon_sync_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      amazon_transactions: {
        Row: {
          amazon_order_id: string | null
          amazon_transaction_id: string
          asin: string | null
          breakdowns: Json | null
          buyer_email: string | null
          buyer_name: string | null
          contexts: Json | null
          created_at: string
          currency: string
          description: string | null
          fba_fulfillment_fee: number | null
          fba_inventory_storage_fee: number | null
          fba_per_unit_fee: number | null
          fba_weight_fee: number | null
          fulfillment_channel: string | null
          gift_wrap_credit: number | null
          gross_sales_amount: number | null
          id: string
          item_title: string | null
          marketplace_facilitator_tax: number | null
          marketplace_id: string | null
          net_amount: number | null
          other_fees: number | null
          posted_date: string
          promotional_rebate: number | null
          quantity: number | null
          raw_response: Json
          referral_fee: number | null
          related_identifiers: Json | null
          sales_tax_collected: number | null
          seller_order_id: string | null
          seller_sku: string | null
          shipping_credit: number | null
          shipping_credit_tax: number | null
          store_name: string | null
          total_amount: number
          total_fees: number | null
          transaction_status: string | null
          transaction_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amazon_order_id?: string | null
          amazon_transaction_id: string
          asin?: string | null
          breakdowns?: Json | null
          buyer_email?: string | null
          buyer_name?: string | null
          contexts?: Json | null
          created_at?: string
          currency: string
          description?: string | null
          fba_fulfillment_fee?: number | null
          fba_inventory_storage_fee?: number | null
          fba_per_unit_fee?: number | null
          fba_weight_fee?: number | null
          fulfillment_channel?: string | null
          gift_wrap_credit?: number | null
          gross_sales_amount?: number | null
          id?: string
          item_title?: string | null
          marketplace_facilitator_tax?: number | null
          marketplace_id?: string | null
          net_amount?: number | null
          other_fees?: number | null
          posted_date: string
          promotional_rebate?: number | null
          quantity?: number | null
          raw_response: Json
          referral_fee?: number | null
          related_identifiers?: Json | null
          sales_tax_collected?: number | null
          seller_order_id?: string | null
          seller_sku?: string | null
          shipping_credit?: number | null
          shipping_credit_tax?: number | null
          store_name?: string | null
          total_amount: number
          total_fees?: number | null
          transaction_status?: string | null
          transaction_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amazon_order_id?: string | null
          amazon_transaction_id?: string
          asin?: string | null
          breakdowns?: Json | null
          buyer_email?: string | null
          buyer_name?: string | null
          contexts?: Json | null
          created_at?: string
          currency?: string
          description?: string | null
          fba_fulfillment_fee?: number | null
          fba_inventory_storage_fee?: number | null
          fba_per_unit_fee?: number | null
          fba_weight_fee?: number | null
          fulfillment_channel?: string | null
          gift_wrap_credit?: number | null
          gross_sales_amount?: number | null
          id?: string
          item_title?: string | null
          marketplace_facilitator_tax?: number | null
          marketplace_id?: string | null
          net_amount?: number | null
          other_fees?: number | null
          posted_date?: string
          promotional_rebate?: number | null
          quantity?: number | null
          raw_response?: Json
          referral_fee?: number | null
          related_identifiers?: Json | null
          sales_tax_collected?: number | null
          seller_order_id?: string | null
          seller_sku?: string | null
          shipping_credit?: number | null
          shipping_credit_tax?: number | null
          store_name?: string | null
          total_amount?: number
          total_fees?: number | null
          transaction_status?: string | null
          transaction_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amazon_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      arbitrage_sync_status: {
        Row: {
          created_at: string
          error_details: Json | null
          error_message: string | null
          id: string
          items_failed: number | null
          items_processed: number | null
          job_type: string
          last_run_at: string | null
          last_run_duration_ms: number | null
          last_success_at: string | null
          next_scheduled_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_details?: Json | null
          error_message?: string | null
          id?: string
          items_failed?: number | null
          items_processed?: number | null
          job_type: string
          last_run_at?: string | null
          last_run_duration_ms?: number | null
          last_success_at?: string | null
          next_scheduled_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_details?: Json | null
          error_message?: string | null
          id?: string
          items_failed?: number | null
          items_processed?: number | null
          job_type?: string
          last_run_at?: string | null
          last_run_duration_ms?: number | null
          last_success_at?: string | null
          next_scheduled_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "arbitrage_sync_status_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      asin_bricklink_mapping: {
        Row: {
          asin: string
          bricklink_set_number: string
          created_at: string
          match_confidence: string
          match_method: string | null
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          asin: string
          bricklink_set_number: string
          created_at?: string
          match_confidence: string
          match_method?: string | null
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          asin?: string
          bricklink_set_number?: string
          created_at?: string
          match_confidence?: string
          match_method?: string | null
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asin_bricklink_mapping_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bricklink_arbitrage_pricing: {
        Row: {
          avg_price: number | null
          bricklink_set_number: string
          condition: string
          country_code: string
          created_at: string
          id: string
          max_price: number | null
          min_price: number | null
          price_detail_json: Json | null
          qty_avg_price: number | null
          snapshot_date: string
          total_lots: number | null
          total_qty: number | null
          user_id: string
        }
        Insert: {
          avg_price?: number | null
          bricklink_set_number: string
          condition?: string
          country_code?: string
          created_at?: string
          id?: string
          max_price?: number | null
          min_price?: number | null
          price_detail_json?: Json | null
          qty_avg_price?: number | null
          snapshot_date: string
          total_lots?: number | null
          total_qty?: number | null
          user_id: string
        }
        Update: {
          avg_price?: number | null
          bricklink_set_number?: string
          condition?: string
          country_code?: string
          created_at?: string
          id?: string
          max_price?: number | null
          min_price?: number | null
          price_detail_json?: Json | null
          qty_avg_price?: number | null
          snapshot_date?: string
          total_lots?: number | null
          total_qty?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bricklink_arbitrage_pricing_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bricklink_sync_config: {
        Row: {
          auto_sync_enabled: boolean
          auto_sync_interval_hours: number
          created_at: string
          historical_import_completed_at: string | null
          historical_import_from_date: string | null
          historical_import_started_at: string | null
          id: string
          include_filed_orders: boolean
          last_auto_sync_at: string | null
          last_sync_date_cursor: string | null
          next_auto_sync_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_sync_enabled?: boolean
          auto_sync_interval_hours?: number
          created_at?: string
          historical_import_completed_at?: string | null
          historical_import_from_date?: string | null
          historical_import_started_at?: string | null
          id?: string
          include_filed_orders?: boolean
          last_auto_sync_at?: string | null
          last_sync_date_cursor?: string | null
          next_auto_sync_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_sync_enabled?: boolean
          auto_sync_interval_hours?: number
          created_at?: string
          historical_import_completed_at?: string | null
          historical_import_from_date?: string | null
          historical_import_started_at?: string | null
          id?: string
          include_filed_orders?: boolean
          last_auto_sync_at?: string | null
          last_sync_date_cursor?: string | null
          next_auto_sync_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bricklink_sync_config_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bricklink_sync_log: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          from_date: string | null
          id: string
          last_sync_cursor: string | null
          orders_created: number | null
          orders_processed: number | null
          orders_skipped: number | null
          orders_updated: number | null
          started_at: string
          status: string
          sync_mode: string
          to_date: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          from_date?: string | null
          id?: string
          last_sync_cursor?: string | null
          orders_created?: number | null
          orders_processed?: number | null
          orders_skipped?: number | null
          orders_updated?: number | null
          started_at: string
          status: string
          sync_mode: string
          to_date?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          from_date?: string | null
          id?: string
          last_sync_cursor?: string | null
          orders_created?: number | null
          orders_processed?: number | null
          orders_skipped?: number | null
          orders_updated?: number | null
          started_at?: string
          status?: string
          sync_mode?: string
          to_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bricklink_sync_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bricklink_transactions: {
        Row: {
          add_charge_1: number | null
          add_charge_2: number | null
          base_currency: string
          base_grand_total: number
          bricklink_order_id: string
          buyer_email: string | null
          buyer_location: string | null
          buyer_name: string
          coupon_credit: number | null
          created_at: string
          credit: number | null
          id: string
          insurance: number | null
          order_date: string
          order_note: string | null
          order_status: string
          order_total: number
          payment_date: string | null
          payment_method: string | null
          payment_status: string | null
          raw_response: Json
          seller_remarks: string | null
          shipping: number | null
          shipping_method: string | null
          status_changed_date: string | null
          tax: number | null
          total_items: number | null
          total_lots: number | null
          tracking_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          add_charge_1?: number | null
          add_charge_2?: number | null
          base_currency?: string
          base_grand_total: number
          bricklink_order_id: string
          buyer_email?: string | null
          buyer_location?: string | null
          buyer_name: string
          coupon_credit?: number | null
          created_at?: string
          credit?: number | null
          id?: string
          insurance?: number | null
          order_date: string
          order_note?: string | null
          order_status: string
          order_total: number
          payment_date?: string | null
          payment_method?: string | null
          payment_status?: string | null
          raw_response: Json
          seller_remarks?: string | null
          shipping?: number | null
          shipping_method?: string | null
          status_changed_date?: string | null
          tax?: number | null
          total_items?: number | null
          total_lots?: number | null
          tracking_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          add_charge_1?: number | null
          add_charge_2?: number | null
          base_currency?: string
          base_grand_total?: number
          bricklink_order_id?: string
          buyer_email?: string | null
          buyer_location?: string | null
          buyer_name?: string
          coupon_credit?: number | null
          created_at?: string
          credit?: number | null
          id?: string
          insurance?: number | null
          order_date?: string
          order_note?: string | null
          order_status?: string
          order_total?: number
          payment_date?: string | null
          payment_method?: string | null
          payment_status?: string | null
          raw_response?: Json
          seller_remarks?: string | null
          shipping?: number | null
          shipping_method?: string | null
          status_changed_date?: string | null
          tax?: number | null
          total_items?: number | null
          total_lots?: number | null
          tracking_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bricklink_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bricklink_upload_sync_config: {
        Row: {
          auto_sync_enabled: boolean
          auto_sync_interval_hours: number
          created_at: string
          id: string
          last_auto_sync_at: string | null
          next_auto_sync_at: string | null
          sync_activated_only: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_sync_enabled?: boolean
          auto_sync_interval_hours?: number
          created_at?: string
          id?: string
          last_auto_sync_at?: string | null
          next_auto_sync_at?: string | null
          sync_activated_only?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_sync_enabled?: boolean
          auto_sync_interval_hours?: number
          created_at?: string
          id?: string
          last_auto_sync_at?: string | null
          next_auto_sync_at?: string | null
          sync_activated_only?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bricklink_upload_sync_config_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bricklink_upload_sync_log: {
        Row: {
          batches_created: number | null
          batches_processed: number | null
          batches_skipped: number | null
          batches_updated: number | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          started_at: string
          status: string
          sync_mode: string
          user_id: string
        }
        Insert: {
          batches_created?: number | null
          batches_processed?: number | null
          batches_skipped?: number | null
          batches_updated?: number | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          started_at: string
          status: string
          sync_mode: string
          user_id: string
        }
        Update: {
          batches_created?: number | null
          batches_processed?: number | null
          batches_skipped?: number | null
          batches_updated?: number | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          started_at?: string
          status?: string
          sync_mode?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bricklink_upload_sync_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bricklink_uploads: {
        Row: {
          bricqer_batch_id: number | null
          bricqer_purchase_id: number | null
          condition: string | null
          cost: number | null
          created_at: string
          id: string
          is_activated: boolean | null
          linked_lot: string | null
          lots: number | null
          notes: string | null
          purchase_id: string | null
          raw_response: Json | null
          reference: string | null
          remaining_price: number | null
          remaining_quantity: number | null
          selling_price: number
          source: string | null
          synced_from_bricqer: boolean | null
          total_quantity: number
          updated_at: string
          upload_date: string
          user_id: string
        }
        Insert: {
          bricqer_batch_id?: number | null
          bricqer_purchase_id?: number | null
          condition?: string | null
          cost?: number | null
          created_at?: string
          id?: string
          is_activated?: boolean | null
          linked_lot?: string | null
          lots?: number | null
          notes?: string | null
          purchase_id?: string | null
          raw_response?: Json | null
          reference?: string | null
          remaining_price?: number | null
          remaining_quantity?: number | null
          selling_price?: number
          source?: string | null
          synced_from_bricqer?: boolean | null
          total_quantity?: number
          updated_at?: string
          upload_date: string
          user_id: string
        }
        Update: {
          bricqer_batch_id?: number | null
          bricqer_purchase_id?: number | null
          condition?: string | null
          cost?: number | null
          created_at?: string
          id?: string
          is_activated?: boolean | null
          linked_lot?: string | null
          lots?: number | null
          notes?: string | null
          purchase_id?: string | null
          raw_response?: Json | null
          reference?: string | null
          remaining_price?: number | null
          remaining_quantity?: number | null
          selling_price?: number
          source?: string | null
          synced_from_bricqer?: boolean | null
          total_quantity?: number
          updated_at?: string
          upload_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bricklink_uploads_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchase_roi_view"
            referencedColumns: ["purchase_id"]
          },
          {
            foreignKeyName: "bricklink_uploads_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bricklink_uploads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brickowl_sync_config: {
        Row: {
          auto_sync_enabled: boolean
          auto_sync_interval_hours: number
          created_at: string
          historical_import_completed_at: string | null
          historical_import_from_date: string | null
          historical_import_started_at: string | null
          id: string
          last_auto_sync_at: string | null
          last_sync_date_cursor: string | null
          next_auto_sync_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_sync_enabled?: boolean
          auto_sync_interval_hours?: number
          created_at?: string
          historical_import_completed_at?: string | null
          historical_import_from_date?: string | null
          historical_import_started_at?: string | null
          id?: string
          last_auto_sync_at?: string | null
          last_sync_date_cursor?: string | null
          next_auto_sync_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_sync_enabled?: boolean
          auto_sync_interval_hours?: number
          created_at?: string
          historical_import_completed_at?: string | null
          historical_import_from_date?: string | null
          historical_import_started_at?: string | null
          id?: string
          last_auto_sync_at?: string | null
          last_sync_date_cursor?: string | null
          next_auto_sync_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brickowl_sync_config_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brickowl_sync_log: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          from_date: string | null
          id: string
          last_sync_cursor: string | null
          orders_created: number | null
          orders_processed: number | null
          orders_skipped: number | null
          orders_updated: number | null
          started_at: string
          status: string
          sync_mode: string
          to_date: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          from_date?: string | null
          id?: string
          last_sync_cursor?: string | null
          orders_created?: number | null
          orders_processed?: number | null
          orders_skipped?: number | null
          orders_updated?: number | null
          started_at: string
          status: string
          sync_mode: string
          to_date?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          from_date?: string | null
          id?: string
          last_sync_cursor?: string | null
          orders_created?: number | null
          orders_processed?: number | null
          orders_skipped?: number | null
          orders_updated?: number | null
          started_at?: string
          status?: string
          sync_mode?: string
          to_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brickowl_sync_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brickowl_transactions: {
        Row: {
          base_currency: string
          base_grand_total: number
          brickowl_order_id: string
          buyer_email: string | null
          buyer_location: string | null
          buyer_name: string
          buyer_note: string | null
          buyer_username: string | null
          combined_shipping_discount: number | null
          coupon_discount: number | null
          created_at: string
          id: string
          order_date: string
          order_status: string
          order_total: number
          payment_method: string | null
          payment_status: string | null
          public_note: string | null
          raw_response: Json
          seller_note: string | null
          shipping: number | null
          shipping_method: string | null
          status_changed_date: string | null
          tax: number | null
          total_items: number | null
          total_lots: number | null
          tracking_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          base_currency?: string
          base_grand_total: number
          brickowl_order_id: string
          buyer_email?: string | null
          buyer_location?: string | null
          buyer_name: string
          buyer_note?: string | null
          buyer_username?: string | null
          combined_shipping_discount?: number | null
          coupon_discount?: number | null
          created_at?: string
          id?: string
          order_date: string
          order_status: string
          order_total: number
          payment_method?: string | null
          payment_status?: string | null
          public_note?: string | null
          raw_response: Json
          seller_note?: string | null
          shipping?: number | null
          shipping_method?: string | null
          status_changed_date?: string | null
          tax?: number | null
          total_items?: number | null
          total_lots?: number | null
          tracking_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          base_currency?: string
          base_grand_total?: number
          brickowl_order_id?: string
          buyer_email?: string | null
          buyer_location?: string | null
          buyer_name?: string
          buyer_note?: string | null
          buyer_username?: string | null
          combined_shipping_discount?: number | null
          coupon_discount?: number | null
          created_at?: string
          id?: string
          order_date?: string
          order_status?: string
          order_total?: number
          payment_method?: string | null
          payment_status?: string | null
          public_note?: string | null
          raw_response?: Json
          seller_note?: string | null
          shipping?: number | null
          shipping_method?: string | null
          status_changed_date?: string | null
          tax?: number | null
          total_items?: number | null
          total_lots?: number | null
          tracking_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brickowl_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brickset_api_credentials: {
        Row: {
          api_key_encrypted: string
          created_at: string
          id: string
          last_used_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_encrypted: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_encrypted?: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brickset_api_credentials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brickset_sets: {
        Row: {
          additional_image_count: number | null
          age_max: number | null
          age_min: number | null
          availability: string | null
          bricklink_sold_price_new: number | null
          bricklink_sold_price_used: number | null
          brickset_id: number | null
          ca_retail_price: number | null
          category: string | null
          created_at: string
          de_retail_price: number | null
          depth: number | null
          designers: string[] | null
          ean: string | null
          eu_item_number: string | null
          exit_date: string | null
          height: number | null
          id: string
          image_filename: string | null
          image_url: string | null
          instructions_count: number | null
          last_fetched_at: string | null
          launch_date: string | null
          minifigs: number | null
          own_count: number | null
          packaging_type: string | null
          pieces: number | null
          rating: number | null
          raw_response: Json | null
          released: boolean | null
          set_name: string
          set_number: string
          subtheme: string | null
          theme: string | null
          theme_group: string | null
          uk_retail_price: number | null
          upc: string | null
          updated_at: string
          us_date_added: string | null
          us_date_removed: string | null
          us_item_number: string | null
          us_retail_price: number | null
          variant: number | null
          want_count: number | null
          weight: number | null
          width: number | null
          year_from: number | null
        }
        Insert: {
          additional_image_count?: number | null
          age_max?: number | null
          age_min?: number | null
          availability?: string | null
          bricklink_sold_price_new?: number | null
          bricklink_sold_price_used?: number | null
          brickset_id?: number | null
          ca_retail_price?: number | null
          category?: string | null
          created_at?: string
          de_retail_price?: number | null
          depth?: number | null
          designers?: string[] | null
          ean?: string | null
          eu_item_number?: string | null
          exit_date?: string | null
          height?: number | null
          id?: string
          image_filename?: string | null
          image_url?: string | null
          instructions_count?: number | null
          last_fetched_at?: string | null
          launch_date?: string | null
          minifigs?: number | null
          own_count?: number | null
          packaging_type?: string | null
          pieces?: number | null
          rating?: number | null
          raw_response?: Json | null
          released?: boolean | null
          set_name: string
          set_number: string
          subtheme?: string | null
          theme?: string | null
          theme_group?: string | null
          uk_retail_price?: number | null
          upc?: string | null
          updated_at?: string
          us_date_added?: string | null
          us_date_removed?: string | null
          us_item_number?: string | null
          us_retail_price?: number | null
          variant?: number | null
          want_count?: number | null
          weight?: number | null
          width?: number | null
          year_from?: number | null
        }
        Update: {
          additional_image_count?: number | null
          age_max?: number | null
          age_min?: number | null
          availability?: string | null
          bricklink_sold_price_new?: number | null
          bricklink_sold_price_used?: number | null
          brickset_id?: number | null
          ca_retail_price?: number | null
          category?: string | null
          created_at?: string
          de_retail_price?: number | null
          depth?: number | null
          designers?: string[] | null
          ean?: string | null
          eu_item_number?: string | null
          exit_date?: string | null
          height?: number | null
          id?: string
          image_filename?: string | null
          image_url?: string | null
          instructions_count?: number | null
          last_fetched_at?: string | null
          launch_date?: string | null
          minifigs?: number | null
          own_count?: number | null
          packaging_type?: string | null
          pieces?: number | null
          rating?: number | null
          raw_response?: Json | null
          released?: boolean | null
          set_name?: string
          set_number?: string
          subtheme?: string | null
          theme?: string | null
          theme_group?: string | null
          uk_retail_price?: number | null
          upc?: string | null
          updated_at?: string
          us_date_added?: string | null
          us_date_removed?: string | null
          us_item_number?: string | null
          us_retail_price?: number | null
          variant?: number | null
          want_count?: number | null
          weight?: number | null
          width?: number | null
          year_from?: number | null
        }
        Relationships: []
      }
      bricqer_stats_cache: {
        Row: {
          created_at: string
          id: string
          inventory_value: number
          last_updated: string
          lot_count: number
          piece_count: number
          storage_locations: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_value?: number
          last_updated?: string
          lot_count?: number
          piece_count?: number
          storage_locations?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          inventory_value?: number
          last_updated?: string
          lot_count?: number
          piece_count?: number
          storage_locations?: number
          user_id?: string
        }
        Relationships: []
      }
      cache_metadata: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          last_sync: string
          record_count: number
          sync_status: string
          table_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id: string
          last_sync?: string
          record_count?: number
          sync_status?: string
          table_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          last_sync?: string
          record_count?: number
          sync_status?: string
          table_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ebay_credentials: {
        Row: {
          access_token: string
          access_token_expires_at: string
          created_at: string
          ebay_user_id: string | null
          id: string
          jwe: string | null
          marketplace_id: string
          private_key: string | null
          public_key: string | null
          refresh_token: string
          refresh_token_expires_at: string
          scopes: string[]
          signing_key_expires_at: string | null
          signing_key_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          access_token_expires_at: string
          created_at?: string
          ebay_user_id?: string | null
          id?: string
          jwe?: string | null
          marketplace_id?: string
          private_key?: string | null
          public_key?: string | null
          refresh_token: string
          refresh_token_expires_at: string
          scopes: string[]
          signing_key_expires_at?: string | null
          signing_key_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          access_token_expires_at?: string
          created_at?: string
          ebay_user_id?: string | null
          id?: string
          jwe?: string | null
          marketplace_id?: string
          private_key?: string | null
          public_key?: string | null
          refresh_token?: string
          refresh_token_expires_at?: string
          scopes?: string[]
          signing_key_expires_at?: string | null
          signing_key_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_credentials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_inventory_resolution_queue: {
        Row: {
          created_at: string
          ebay_line_item_id: string
          ebay_order_id: string
          id: string
          match_candidates: Json | null
          order_date: string
          quantity: number
          quantity_needed: number | null
          resolution_reason: string
          resolved_at: string | null
          resolved_by: string | null
          resolved_inventory_item_ids: string[] | null
          sku: string | null
          status: string
          title: string
          total_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ebay_line_item_id: string
          ebay_order_id: string
          id?: string
          match_candidates?: Json | null
          order_date: string
          quantity?: number
          quantity_needed?: number | null
          resolution_reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_inventory_item_ids?: string[] | null
          sku?: string | null
          status?: string
          title: string
          total_amount: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ebay_line_item_id?: string
          ebay_order_id?: string
          id?: string
          match_candidates?: Json | null
          order_date?: string
          quantity?: number
          quantity_needed?: number | null
          resolution_reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_inventory_item_ids?: string[] | null
          sku?: string | null
          status?: string
          title?: string
          total_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_inventory_resolution_queue_ebay_line_item_id_fkey"
            columns: ["ebay_line_item_id"]
            isOneToOne: true
            referencedRelation: "ebay_order_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebay_inventory_resolution_queue_ebay_order_id_fkey"
            columns: ["ebay_order_id"]
            isOneToOne: false
            referencedRelation: "ebay_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebay_inventory_resolution_queue_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebay_inventory_resolution_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_order_line_items: {
        Row: {
          created_at: string
          ebay_line_item_id: string
          fulfilment_status: string
          id: string
          inventory_item_id: string | null
          inventory_link_method: string | null
          inventory_linked_at: string | null
          item_location: string | null
          legacy_item_id: string | null
          line_item_cost_amount: number
          line_item_cost_currency: string
          listing_marketplace_id: string | null
          order_id: string
          properties: Json | null
          purchase_marketplace_id: string | null
          quantity: number
          raw_response: Json
          sku: string | null
          taxes: Json | null
          title: string
          total_amount: number
          total_currency: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ebay_line_item_id: string
          fulfilment_status: string
          id?: string
          inventory_item_id?: string | null
          inventory_link_method?: string | null
          inventory_linked_at?: string | null
          item_location?: string | null
          legacy_item_id?: string | null
          line_item_cost_amount: number
          line_item_cost_currency: string
          listing_marketplace_id?: string | null
          order_id: string
          properties?: Json | null
          purchase_marketplace_id?: string | null
          quantity: number
          raw_response: Json
          sku?: string | null
          taxes?: Json | null
          title: string
          total_amount: number
          total_currency: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ebay_line_item_id?: string
          fulfilment_status?: string
          id?: string
          inventory_item_id?: string | null
          inventory_link_method?: string | null
          inventory_linked_at?: string | null
          item_location?: string | null
          legacy_item_id?: string | null
          line_item_cost_amount?: number
          line_item_cost_currency?: string
          listing_marketplace_id?: string | null
          order_id?: string
          properties?: Json | null
          purchase_marketplace_id?: string | null
          quantity?: number
          raw_response?: Json
          sku?: string | null
          taxes?: Json | null
          title?: string
          total_amount?: number
          total_currency?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_order_line_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebay_order_line_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items_with_age"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebay_order_line_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "ebay_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_orders: {
        Row: {
          buyer_checkout_notes: string | null
          buyer_username: string
          cancel_status: Json | null
          created_at: string
          creation_date: string
          ebay_order_id: string
          fulfilment_instructions: Json | null
          id: string
          inventory_link_status: string | null
          inventory_linked_at: string | null
          last_modified_date: string
          legacy_order_id: string | null
          order_fulfilment_status: string
          order_payment_status: string
          payment_summary: Json | null
          pricing_summary: Json | null
          raw_response: Json
          sales_record_reference: string | null
          total_fee_basis_amount: number | null
          total_fee_basis_currency: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          buyer_checkout_notes?: string | null
          buyer_username: string
          cancel_status?: Json | null
          created_at?: string
          creation_date: string
          ebay_order_id: string
          fulfilment_instructions?: Json | null
          id?: string
          inventory_link_status?: string | null
          inventory_linked_at?: string | null
          last_modified_date: string
          legacy_order_id?: string | null
          order_fulfilment_status: string
          order_payment_status: string
          payment_summary?: Json | null
          pricing_summary?: Json | null
          raw_response: Json
          sales_record_reference?: string | null
          total_fee_basis_amount?: number | null
          total_fee_basis_currency?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          buyer_checkout_notes?: string | null
          buyer_username?: string
          cancel_status?: Json | null
          created_at?: string
          creation_date?: string
          ebay_order_id?: string
          fulfilment_instructions?: Json | null
          id?: string
          inventory_link_status?: string | null
          inventory_linked_at?: string | null
          last_modified_date?: string
          legacy_order_id?: string | null
          order_fulfilment_status?: string
          order_payment_status?: string
          payment_summary?: Json | null
          pricing_summary?: Json | null
          raw_response?: Json
          sales_record_reference?: string | null
          total_fee_basis_amount?: number | null
          total_fee_basis_currency?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_payouts: {
        Row: {
          amount: number
          bank_reference: string | null
          created_at: string
          currency: string
          ebay_payout_id: string
          id: string
          last_attempted_payout_date: string | null
          payout_date: string
          payout_instrument: Json | null
          payout_memo: string | null
          payout_status: string
          raw_response: Json
          transaction_count: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          bank_reference?: string | null
          created_at?: string
          currency: string
          ebay_payout_id: string
          id?: string
          last_attempted_payout_date?: string | null
          payout_date: string
          payout_instrument?: Json | null
          payout_memo?: string | null
          payout_status: string
          raw_response: Json
          transaction_count?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          bank_reference?: string | null
          created_at?: string
          currency?: string
          ebay_payout_id?: string
          id?: string
          last_attempted_payout_date?: string | null
          payout_date?: string
          payout_instrument?: Json | null
          payout_memo?: string | null
          payout_status?: string
          raw_response?: Json
          transaction_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_payouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_pricing: {
        Row: {
          avg_price: number | null
          condition: string
          country_code: string
          created_at: string
          id: string
          listings_json: Json | null
          max_price: number | null
          min_price: number | null
          set_number: string
          snapshot_date: string
          total_listings: number | null
        }
        Insert: {
          avg_price?: number | null
          condition?: string
          country_code?: string
          created_at?: string
          id?: string
          listings_json?: Json | null
          max_price?: number | null
          min_price?: number | null
          set_number: string
          snapshot_date: string
          total_listings?: number | null
        }
        Update: {
          avg_price?: number | null
          condition?: string
          country_code?: string
          created_at?: string
          id?: string
          listings_json?: Json | null
          max_price?: number | null
          min_price?: number | null
          set_number?: string
          snapshot_date?: string
          total_listings?: number | null
        }
        Relationships: []
      }
      ebay_shipping_fulfilments: {
        Row: {
          created_at: string
          ebay_fulfilment_id: string
          id: string
          line_items: Json
          order_id: string
          raw_response: Json
          shipped_date: string | null
          shipping_carrier_code: string | null
          tracking_number: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          ebay_fulfilment_id: string
          id?: string
          line_items: Json
          order_id: string
          raw_response: Json
          shipped_date?: string | null
          shipping_carrier_code?: string | null
          tracking_number?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          ebay_fulfilment_id?: string
          id?: string
          line_items?: Json
          order_id?: string
          raw_response?: Json
          shipped_date?: string | null
          shipping_carrier_code?: string | null
          tracking_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_shipping_fulfilments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "ebay_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_sku_mappings: {
        Row: {
          created_at: string
          ebay_sku: string
          id: string
          inventory_item_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ebay_sku: string
          id?: string
          inventory_item_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ebay_sku?: string
          id?: string
          inventory_item_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_sku_mappings_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebay_sku_mappings_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items_with_age"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebay_sku_mappings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_sync_config: {
        Row: {
          auto_sync_enabled: boolean
          auto_sync_interval_hours: number
          created_at: string
          from_date: string | null
          historical_import_completed_at: string | null
          historical_import_from_date: string | null
          historical_import_started_at: string | null
          id: string
          last_auto_sync_at: string | null
          next_auto_sync_at: string | null
          orders_last_modified_cursor: string | null
          payouts_date_cursor: string | null
          to_date: string | null
          transactions_date_cursor: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_sync_enabled?: boolean
          auto_sync_interval_hours?: number
          created_at?: string
          from_date?: string | null
          historical_import_completed_at?: string | null
          historical_import_from_date?: string | null
          historical_import_started_at?: string | null
          id?: string
          last_auto_sync_at?: string | null
          next_auto_sync_at?: string | null
          orders_last_modified_cursor?: string | null
          payouts_date_cursor?: string | null
          to_date?: string | null
          transactions_date_cursor?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_sync_enabled?: boolean
          auto_sync_interval_hours?: number
          created_at?: string
          from_date?: string | null
          historical_import_completed_at?: string | null
          historical_import_from_date?: string | null
          historical_import_started_at?: string | null
          id?: string
          last_auto_sync_at?: string | null
          next_auto_sync_at?: string | null
          orders_last_modified_cursor?: string | null
          payouts_date_cursor?: string | null
          to_date?: string | null
          transactions_date_cursor?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_sync_config_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_sync_log: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          from_date: string | null
          id: string
          last_sync_cursor: string | null
          records_created: number | null
          records_processed: number | null
          records_updated: number | null
          started_at: string
          status: string
          sync_mode: string | null
          sync_type: string
          to_date: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          from_date?: string | null
          id?: string
          last_sync_cursor?: string | null
          records_created?: number | null
          records_processed?: number | null
          records_updated?: number | null
          started_at: string
          status: string
          sync_mode?: string | null
          sync_type: string
          to_date?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          from_date?: string | null
          id?: string
          last_sync_cursor?: string | null
          records_created?: number | null
          records_processed?: number | null
          records_updated?: number | null
          started_at?: string
          status?: string
          sync_mode?: string | null
          sync_type?: string
          to_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_sync_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_transactions: {
        Row: {
          ad_fee: number | null
          amount: number
          booking_entry: string
          buyer_username: string | null
          created_at: string
          currency: string
          custom_label: string | null
          ebay_order_id: string | null
          ebay_transaction_id: string
          final_value_fee_fixed: number | null
          final_value_fee_variable: number | null
          gross_transaction_amount: number | null
          id: string
          insertion_fee: number | null
          international_fee: number | null
          item_location_country: string | null
          item_title: string | null
          order_line_items: Json | null
          payout_id: string | null
          postage_and_packaging: number | null
          quantity: number | null
          raw_response: Json
          regulatory_operating_fee: number | null
          sales_record_reference: string | null
          total_fee_amount: number | null
          total_fee_currency: string | null
          total_price: number | null
          transaction_date: string
          transaction_memo: string | null
          transaction_status: string
          transaction_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ad_fee?: number | null
          amount: number
          booking_entry: string
          buyer_username?: string | null
          created_at?: string
          currency: string
          custom_label?: string | null
          ebay_order_id?: string | null
          ebay_transaction_id: string
          final_value_fee_fixed?: number | null
          final_value_fee_variable?: number | null
          gross_transaction_amount?: number | null
          id?: string
          insertion_fee?: number | null
          international_fee?: number | null
          item_location_country?: string | null
          item_title?: string | null
          order_line_items?: Json | null
          payout_id?: string | null
          postage_and_packaging?: number | null
          quantity?: number | null
          raw_response: Json
          regulatory_operating_fee?: number | null
          sales_record_reference?: string | null
          total_fee_amount?: number | null
          total_fee_currency?: string | null
          total_price?: number | null
          transaction_date: string
          transaction_memo?: string | null
          transaction_status: string
          transaction_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ad_fee?: number | null
          amount?: number
          booking_entry?: string
          buyer_username?: string | null
          created_at?: string
          currency?: string
          custom_label?: string | null
          ebay_order_id?: string | null
          ebay_transaction_id?: string
          final_value_fee_fixed?: number | null
          final_value_fee_variable?: number | null
          gross_transaction_amount?: number | null
          id?: string
          insertion_fee?: number | null
          international_fee?: number | null
          item_location_country?: string | null
          item_title?: string | null
          order_line_items?: Json | null
          payout_id?: string | null
          postage_and_packaging?: number | null
          quantity?: number | null
          raw_response?: Json
          regulatory_operating_fee?: number | null
          sales_record_reference?: string | null
          total_fee_amount?: number | null
          total_fee_currency?: string | null
          total_price?: number | null
          transaction_date?: string
          transaction_memo?: string | null
          transaction_status?: string
          transaction_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      excluded_ebay_listings: {
        Row: {
          ebay_item_id: string
          excluded_at: string
          id: string
          reason: string | null
          set_number: string
          title: string | null
          user_id: string
        }
        Insert: {
          ebay_item_id: string
          excluded_at?: string
          id?: string
          reason?: string | null
          set_number: string
          title?: string | null
          user_id: string
        }
        Update: {
          ebay_item_id?: string
          excluded_at?: string
          id?: string
          reason?: string | null
          set_number?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "excluded_ebay_listings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          order_id: string | null
          platform: string | null
          raw_data: Json | null
          transaction_date: string
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          platform?: string | null
          raw_data?: Json | null
          transaction_date: string
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          platform?: string | null
          raw_data?: Json | null
          transaction_date?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "platform_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          amazon_asin: string | null
          amazon_order_item_id: string | null
          archive_location: string | null
          condition: string | null
          cost: number | null
          created_at: string
          ebay_line_item_id: string | null
          id: string
          item_name: string | null
          linked_lot: string | null
          listing_date: string | null
          listing_platform: string | null
          listing_value: number | null
          notes: string | null
          purchase_date: string | null
          purchase_id: string | null
          returned_from_item_id: string | null
          set_number: string
          sheets_synced_at: string | null
          sku: string | null
          sold_at: string | null
          sold_date: string | null
          sold_fees_amount: number | null
          sold_gross_amount: number | null
          sold_net_amount: number | null
          sold_order_id: string | null
          sold_platform: string | null
          sold_postage_received: number | null
          sold_price: number | null
          source: string | null
          status: string | null
          storage_location: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amazon_asin?: string | null
          amazon_order_item_id?: string | null
          archive_location?: string | null
          condition?: string | null
          cost?: number | null
          created_at?: string
          ebay_line_item_id?: string | null
          id?: string
          item_name?: string | null
          linked_lot?: string | null
          listing_date?: string | null
          listing_platform?: string | null
          listing_value?: number | null
          notes?: string | null
          purchase_date?: string | null
          purchase_id?: string | null
          returned_from_item_id?: string | null
          set_number: string
          sheets_synced_at?: string | null
          sku?: string | null
          sold_at?: string | null
          sold_date?: string | null
          sold_fees_amount?: number | null
          sold_gross_amount?: number | null
          sold_net_amount?: number | null
          sold_order_id?: string | null
          sold_platform?: string | null
          sold_postage_received?: number | null
          sold_price?: number | null
          source?: string | null
          status?: string | null
          storage_location?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amazon_asin?: string | null
          amazon_order_item_id?: string | null
          archive_location?: string | null
          condition?: string | null
          cost?: number | null
          created_at?: string
          ebay_line_item_id?: string | null
          id?: string
          item_name?: string | null
          linked_lot?: string | null
          listing_date?: string | null
          listing_platform?: string | null
          listing_value?: number | null
          notes?: string | null
          purchase_date?: string | null
          purchase_id?: string | null
          returned_from_item_id?: string | null
          set_number?: string
          sheets_synced_at?: string | null
          sku?: string | null
          sold_at?: string | null
          sold_date?: string | null
          sold_fees_amount?: number | null
          sold_gross_amount?: number | null
          sold_net_amount?: number | null
          sold_order_id?: string | null
          sold_platform?: string | null
          sold_postage_received?: number | null
          sold_price?: number | null
          source?: string | null
          status?: string | null
          storage_location?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_amazon_order_item_id_fkey"
            columns: ["amazon_order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_ebay_line_item_id_fkey"
            columns: ["ebay_line_item_id"]
            isOneToOne: false
            referencedRelation: "ebay_order_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchase_roi_view"
            referencedColumns: ["purchase_id"]
          },
          {
            foreignKeyName: "inventory_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_returned_from_item_id_fkey"
            columns: ["returned_from_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_returned_from_item_id_fkey"
            columns: ["returned_from_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items_with_age"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mileage_tracking: {
        Row: {
          amount_claimed: number
          created_at: string
          destination_postcode: string
          expense_type: string
          id: string
          miles_travelled: number
          notes: string | null
          purchase_id: string | null
          reason: string
          tracking_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_claimed: number
          created_at?: string
          destination_postcode: string
          expense_type?: string
          id?: string
          miles_travelled: number
          notes?: string | null
          purchase_id?: string | null
          reason: string
          tracking_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_claimed?: number
          created_at?: string
          destination_postcode?: string
          expense_type?: string
          id?: string
          miles_travelled?: number
          notes?: string | null
          purchase_id?: string | null
          reason?: string
          tracking_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mileage_tracking_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchase_roi_view"
            referencedColumns: ["purchase_id"]
          },
          {
            foreignKeyName: "mileage_tracking_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_tracking_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monzo_credentials: {
        Row: {
          access_token: string
          access_token_expires_at: string
          account_id: string
          account_type: string | null
          created_at: string
          id: string
          monzo_user_id: string | null
          refresh_token: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          access_token_expires_at: string
          account_id: string
          account_type?: string | null
          created_at?: string
          id?: string
          monzo_user_id?: string | null
          refresh_token?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          access_token_expires_at?: string
          account_id?: string
          account_type?: string | null
          created_at?: string
          id?: string
          monzo_user_id?: string | null
          refresh_token?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monzo_credentials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monzo_sync_log: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          last_transaction_id: string | null
          source: string | null
          started_at: string
          status: string
          sync_type: string
          transactions_created: number | null
          transactions_processed: number | null
          transactions_updated: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          last_transaction_id?: string | null
          source?: string | null
          started_at: string
          status: string
          sync_type: string
          transactions_created?: number | null
          transactions_processed?: number | null
          transactions_updated?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          last_transaction_id?: string | null
          source?: string | null
          started_at?: string
          status?: string
          sync_type?: string
          transactions_created?: number | null
          transactions_processed?: number | null
          transactions_updated?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monzo_sync_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monzo_transactions: {
        Row: {
          account_id: string | null
          address: string | null
          amount: number
          category: string | null
          created: string
          created_at: string
          currency: string
          data_source: string | null
          decline_reason: string | null
          description: string | null
          emoji: string | null
          id: string
          is_load: boolean | null
          local_amount: number | null
          local_category: string | null
          local_currency: string | null
          merchant: Json | null
          merchant_name: string | null
          metadata: Json | null
          monzo_transaction_id: string
          raw_response: Json | null
          settled: string | null
          tags: string[] | null
          transaction_time: string | null
          transaction_type: string | null
          updated_at: string
          user_id: string
          user_notes: string | null
        }
        Insert: {
          account_id?: string | null
          address?: string | null
          amount: number
          category?: string | null
          created: string
          created_at?: string
          currency?: string
          data_source?: string | null
          decline_reason?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          is_load?: boolean | null
          local_amount?: number | null
          local_category?: string | null
          local_currency?: string | null
          merchant?: Json | null
          merchant_name?: string | null
          metadata?: Json | null
          monzo_transaction_id: string
          raw_response?: Json | null
          settled?: string | null
          tags?: string[] | null
          transaction_time?: string | null
          transaction_type?: string | null
          updated_at?: string
          user_id: string
          user_notes?: string | null
        }
        Update: {
          account_id?: string | null
          address?: string | null
          amount?: number
          category?: string | null
          created?: string
          created_at?: string
          currency?: string
          data_source?: string | null
          decline_reason?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          is_load?: boolean | null
          local_amount?: number | null
          local_category?: string | null
          local_currency?: string | null
          merchant?: Json | null
          merchant_name?: string | null
          metadata?: Json | null
          monzo_transaction_id?: string
          raw_response?: Json | null
          settled?: string | null
          tags?: string[] | null
          transaction_time?: string | null
          transaction_type?: string | null
          updated_at?: string
          user_id?: string
          user_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monzo_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          amazon_link_method: string | null
          amazon_linked_at: string | null
          color_id: number | null
          color_name: string | null
          condition: string | null
          created_at: string
          currency: string | null
          id: string
          inventory_item_id: string | null
          item_name: string | null
          item_number: string
          item_type: string | null
          order_id: string
          quantity: number
          total_price: number | null
          unit_price: number | null
        }
        Insert: {
          amazon_link_method?: string | null
          amazon_linked_at?: string | null
          color_id?: number | null
          color_name?: string | null
          condition?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          inventory_item_id?: string | null
          item_name?: string | null
          item_number: string
          item_type?: string | null
          order_id: string
          quantity?: number
          total_price?: number | null
          unit_price?: number | null
        }
        Update: {
          amazon_link_method?: string | null
          amazon_linked_at?: string | null
          color_id?: number | null
          color_name?: string | null
          condition?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          inventory_item_id?: string | null
          item_name?: string | null
          item_number?: string
          item_type?: string | null
          order_id?: string
          quantity?: number
          total_price?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items_with_age"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "platform_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          notes: string | null
          order_id: string
          previous_status: string | null
          status: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          order_id: string
          previous_status?: string | null
          status: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          order_id?: string
          previous_status?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "platform_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      paypal_credentials: {
        Row: {
          access_token: string | null
          access_token_expires_at: string | null
          client_id: string
          client_secret: string
          created_at: string
          id: string
          sandbox: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          access_token_expires_at?: string | null
          client_id: string
          client_secret: string
          created_at?: string
          id?: string
          sandbox?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          access_token_expires_at?: string | null
          client_id?: string
          client_secret?: string
          created_at?: string
          id?: string
          sandbox?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paypal_credentials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      paypal_sync_config: {
        Row: {
          auto_sync_enabled: boolean
          auto_sync_interval_hours: number
          created_at: string
          historical_import_completed_at: string | null
          historical_import_from_date: string | null
          historical_import_started_at: string | null
          id: string
          last_auto_sync_at: string | null
          last_sync_date_cursor: string | null
          next_auto_sync_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_sync_enabled?: boolean
          auto_sync_interval_hours?: number
          created_at?: string
          historical_import_completed_at?: string | null
          historical_import_from_date?: string | null
          historical_import_started_at?: string | null
          id?: string
          last_auto_sync_at?: string | null
          last_sync_date_cursor?: string | null
          next_auto_sync_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_sync_enabled?: boolean
          auto_sync_interval_hours?: number
          created_at?: string
          historical_import_completed_at?: string | null
          historical_import_from_date?: string | null
          historical_import_started_at?: string | null
          id?: string
          last_auto_sync_at?: string | null
          last_sync_date_cursor?: string | null
          next_auto_sync_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paypal_sync_config_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      paypal_sync_log: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          from_date: string | null
          id: string
          last_sync_cursor: string | null
          started_at: string
          status: string
          sync_mode: string
          to_date: string | null
          transactions_created: number | null
          transactions_processed: number | null
          transactions_skipped: number | null
          transactions_updated: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          from_date?: string | null
          id?: string
          last_sync_cursor?: string | null
          started_at: string
          status: string
          sync_mode: string
          to_date?: string | null
          transactions_created?: number | null
          transactions_processed?: number | null
          transactions_skipped?: number | null
          transactions_updated?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          from_date?: string | null
          id?: string
          last_sync_cursor?: string | null
          started_at?: string
          status?: string
          sync_mode?: string
          to_date?: string | null
          transactions_created?: number | null
          transactions_processed?: number | null
          transactions_skipped?: number | null
          transactions_updated?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paypal_sync_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      paypal_transactions: {
        Row: {
          balance_amount: number | null
          bank_account: string | null
          bank_name: string | null
          created_at: string
          currency: string
          description: string | null
          fee_amount: number
          from_email: string | null
          gross_amount: number
          id: string
          invoice_id: string | null
          net_amount: number
          payer_name: string | null
          paypal_transaction_id: string
          postage_amount: number | null
          raw_response: Json
          reference_txn_id: string | null
          time_zone: string | null
          transaction_date: string
          transaction_event_code: string | null
          transaction_status: string | null
          transaction_type: string | null
          transaction_updated_date: string | null
          updated_at: string
          user_id: string
          vat_amount: number | null
        }
        Insert: {
          balance_amount?: number | null
          bank_account?: string | null
          bank_name?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          fee_amount: number
          from_email?: string | null
          gross_amount: number
          id?: string
          invoice_id?: string | null
          net_amount: number
          payer_name?: string | null
          paypal_transaction_id: string
          postage_amount?: number | null
          raw_response: Json
          reference_txn_id?: string | null
          time_zone?: string | null
          transaction_date: string
          transaction_event_code?: string | null
          transaction_status?: string | null
          transaction_type?: string | null
          transaction_updated_date?: string | null
          updated_at?: string
          user_id: string
          vat_amount?: number | null
        }
        Update: {
          balance_amount?: number | null
          bank_account?: string | null
          bank_name?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          fee_amount?: number
          from_email?: string | null
          gross_amount?: number
          id?: string
          invoice_id?: string | null
          net_amount?: number
          payer_name?: string | null
          paypal_transaction_id?: string
          postage_amount?: number | null
          raw_response?: Json
          reference_txn_id?: string | null
          time_zone?: string | null
          transaction_date?: string
          transaction_event_code?: string | null
          transaction_status?: string | null
          transaction_type?: string | null
          transaction_updated_date?: string | null
          updated_at?: string
          user_id?: string
          vat_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "paypal_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_credentials: {
        Row: {
          created_at: string
          credentials_encrypted: string
          id: string
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credentials_encrypted: string
          id?: string
          platform: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credentials_encrypted?: string
          id?: string
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_credentials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_listing_imports: {
        Row: {
          amazon_report_document_id: string | null
          amazon_report_id: string | null
          amazon_report_type: string | null
          completed_at: string | null
          created_at: string
          ebay_page_number: number | null
          ebay_total_entries: number | null
          ebay_total_pages: number | null
          error_count: number | null
          error_details: Json | null
          error_message: string | null
          id: string
          import_type: string
          platform: string
          processed_rows: number | null
          started_at: string | null
          status: string
          total_rows: number | null
          user_id: string
        }
        Insert: {
          amazon_report_document_id?: string | null
          amazon_report_id?: string | null
          amazon_report_type?: string | null
          completed_at?: string | null
          created_at?: string
          ebay_page_number?: number | null
          ebay_total_entries?: number | null
          ebay_total_pages?: number | null
          error_count?: number | null
          error_details?: Json | null
          error_message?: string | null
          id?: string
          import_type?: string
          platform: string
          processed_rows?: number | null
          started_at?: string | null
          status?: string
          total_rows?: number | null
          user_id: string
        }
        Update: {
          amazon_report_document_id?: string | null
          amazon_report_id?: string | null
          amazon_report_type?: string | null
          completed_at?: string | null
          created_at?: string
          ebay_page_number?: number | null
          ebay_total_entries?: number | null
          ebay_total_pages?: number | null
          error_count?: number | null
          error_details?: Json | null
          error_message?: string | null
          id?: string
          import_type?: string
          platform?: string
          processed_rows?: number | null
          started_at?: string | null
          status?: string
          total_rows?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_listing_imports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_listings: {
        Row: {
          amazon_data: Json | null
          bricklink_data: Json | null
          created_at: string
          currency: string | null
          ebay_data: Json | null
          fulfillment_channel: string | null
          id: string
          import_id: string
          listing_status: string | null
          platform: string
          platform_item_id: string
          platform_sku: string | null
          price: number | null
          quantity: number | null
          raw_data: Json
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amazon_data?: Json | null
          bricklink_data?: Json | null
          created_at?: string
          currency?: string | null
          ebay_data?: Json | null
          fulfillment_channel?: string | null
          id?: string
          import_id: string
          listing_status?: string | null
          platform: string
          platform_item_id: string
          platform_sku?: string | null
          price?: number | null
          quantity?: number | null
          raw_data: Json
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amazon_data?: Json | null
          bricklink_data?: Json | null
          created_at?: string
          currency?: string | null
          ebay_data?: Json | null
          fulfillment_channel?: string | null
          id?: string
          import_id?: string
          listing_status?: string | null
          platform?: string
          platform_item_id?: string
          platform_sku?: string | null
          price?: number | null
          quantity?: number | null
          raw_data?: Json
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_listings_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "platform_listing_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_listings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_orders: {
        Row: {
          buyer_email: string | null
          buyer_name: string | null
          cancelled_at: string | null
          completed_at: string | null
          currency: string | null
          fees: number | null
          fulfilled_at: string | null
          id: string
          internal_status: string | null
          inventory_link_status: string | null
          items_count: number | null
          notes: string | null
          order_date: string | null
          packed_at: string | null
          platform: string
          platform_order_id: string
          raw_data: Json | null
          shipped_at: string | null
          shipping: number | null
          shipping_address: Json | null
          shipping_carrier: string | null
          shipping_cost_actual: number | null
          shipping_method: string | null
          status: string | null
          subtotal: number | null
          synced_at: string | null
          total: number | null
          tracking_number: string | null
          user_id: string
        }
        Insert: {
          buyer_email?: string | null
          buyer_name?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          currency?: string | null
          fees?: number | null
          fulfilled_at?: string | null
          id?: string
          internal_status?: string | null
          inventory_link_status?: string | null
          items_count?: number | null
          notes?: string | null
          order_date?: string | null
          packed_at?: string | null
          platform: string
          platform_order_id: string
          raw_data?: Json | null
          shipped_at?: string | null
          shipping?: number | null
          shipping_address?: Json | null
          shipping_carrier?: string | null
          shipping_cost_actual?: number | null
          shipping_method?: string | null
          status?: string | null
          subtotal?: number | null
          synced_at?: string | null
          total?: number | null
          tracking_number?: string | null
          user_id: string
        }
        Update: {
          buyer_email?: string | null
          buyer_name?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          currency?: string | null
          fees?: number | null
          fulfilled_at?: string | null
          id?: string
          internal_status?: string | null
          inventory_link_status?: string | null
          items_count?: number | null
          notes?: string | null
          order_date?: string | null
          packed_at?: string | null
          platform?: string
          platform_order_id?: string
          raw_data?: Json | null
          shipped_at?: string | null
          shipping?: number | null
          shipping_address?: Json | null
          shipping_carrier?: string | null
          shipping_cost_actual?: number | null
          shipping_method?: string | null
          status?: string | null
          subtotal?: number | null
          synced_at?: string | null
          total?: number | null
          tracking_number?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_store_status: {
        Row: {
          created_at: string
          date: string
          id: string
          platform: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          platform: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          platform?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_store_status_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          business_name: string | null
          created_at: string
          home_address: string | null
          home_postcode: string | null
          id: string
          updated_at: string
        }
        Insert: {
          business_name?: string | null
          created_at?: string
          home_address?: string | null
          home_postcode?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          business_name?: string | null
          created_at?: string
          home_address?: string | null
          home_postcode?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchases: {
        Row: {
          cost: number
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          payment_method: string | null
          purchase_date: string
          reference: string | null
          sheets_id: string | null
          sheets_synced_at: string | null
          short_description: string
          source: string | null
          user_id: string
        }
        Insert: {
          cost: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          payment_method?: string | null
          purchase_date: string
          reference?: string | null
          sheets_id?: string | null
          sheets_synced_at?: string | null
          short_description: string
          source?: string | null
          user_id: string
        }
        Update: {
          cost?: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          payment_method?: string | null
          purchase_date?: string
          reference?: string | null
          sheets_id?: string | null
          sheets_synced_at?: string | null
          short_description?: string
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          color_name: string | null
          condition: string | null
          created_at: string
          id: string
          inventory_item_id: string | null
          item_name: string | null
          item_number: string
          item_type: string | null
          quantity: number
          sale_id: string
          total_price: number
          unit_cost: number | null
          unit_price: number
        }
        Insert: {
          color_name?: string | null
          condition?: string | null
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          item_name?: string | null
          item_number: string
          item_type?: string | null
          quantity?: number
          sale_id: string
          total_price: number
          unit_cost?: number | null
          unit_price: number
        }
        Update: {
          color_name?: string | null
          condition?: string | null
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          item_name?: string | null
          item_number?: string
          item_type?: string | null
          quantity?: number
          sale_id?: string
          total_price?: number
          unit_cost?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items_with_age"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          buyer_email: string | null
          buyer_name: string | null
          cost_of_goods: number | null
          created_at: string
          currency: string | null
          description: string | null
          gross_profit: number | null
          id: string
          net_revenue: number | null
          notes: string | null
          order_id: string | null
          other_costs: number | null
          platform: string | null
          platform_fees: number | null
          platform_order_id: string | null
          sale_amount: number
          sale_date: string
          shipping_charged: number | null
          shipping_cost: number | null
          shipping_expense: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          buyer_email?: string | null
          buyer_name?: string | null
          cost_of_goods?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          gross_profit?: number | null
          id?: string
          net_revenue?: number | null
          notes?: string | null
          order_id?: string | null
          other_costs?: number | null
          platform?: string | null
          platform_fees?: number | null
          platform_order_id?: string | null
          sale_amount: number
          sale_date: string
          shipping_charged?: number | null
          shipping_cost?: number | null
          shipping_expense?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          buyer_email?: string | null
          buyer_name?: string | null
          cost_of_goods?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          gross_profit?: number | null
          id?: string
          net_revenue?: number | null
          notes?: string | null
          order_id?: string | null
          other_costs?: number | null
          platform?: string | null
          platform_fees?: number | null
          platform_order_id?: string | null
          sale_amount?: number
          sale_date?: string
          shipping_charged?: number | null
          shipping_cost?: number | null
          shipping_expense?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "platform_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_audit_log: {
        Row: {
          action: string
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          origin: string | null
          records_affected: number | null
          referer: string | null
          table_name: string
          timestamp: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          origin?: string | null
          records_affected?: number | null
          referer?: string | null
          table_name: string
          timestamp?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          origin?: string | null
          records_affected?: number | null
          referer?: string | null
          table_name?: string
          timestamp?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tracked_asins: {
        Row: {
          added_at: string
          asin: string
          created_at: string
          excluded_at: string | null
          exclusion_reason: string | null
          id: string
          image_url: string | null
          last_synced_at: string | null
          name: string | null
          quantity: number | null
          sku: string | null
          source: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          added_at?: string
          asin: string
          created_at?: string
          excluded_at?: string | null
          exclusion_reason?: string | null
          id?: string
          image_url?: string | null
          last_synced_at?: string | null
          name?: string | null
          quantity?: number | null
          sku?: string | null
          source: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          added_at?: string
          asin?: string
          created_at?: string
          excluded_at?: string | null
          exclusion_reason?: string | null
          id?: string
          image_url?: string | null
          last_synced_at?: string | null
          name?: string | null
          quantity?: number | null
          sku?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracked_asins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_tags: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_tags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          created_at: string
          google_sheets_config: Json | null
          id: string
          payment_methods: string[] | null
          report_settings: Json | null
          source_options: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          google_sheets_config?: Json | null
          id?: string
          payment_methods?: string[] | null
          report_settings?: Json | null
          source_options?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          google_sheets_config?: Json | null
          id?: string
          payment_methods?: string[] | null
          report_settings?: Json | null
          source_options?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      arbitrage_current_view: {
        Row: {
          amazon_snapshot_date: string | null
          amazon_url: string | null
          asin: string | null
          bl_avg_price: number | null
          bl_max_price: number | null
          bl_min_price: number | null
          bl_price_detail: Json | null
          bl_snapshot_date: string | null
          bl_total_lots: number | null
          bl_total_qty: number | null
          bricklink_set_number: string | null
          buy_box_is_yours: boolean | null
          buy_box_price: number | null
          ebay_avg_price: number | null
          ebay_listings: Json | null
          ebay_margin_absolute: number | null
          ebay_margin_percent: number | null
          ebay_max_price: number | null
          ebay_min_price: number | null
          ebay_snapshot_date: string | null
          ebay_total_listings: number | null
          image_url: string | null
          margin_absolute: number | null
          margin_percent: number | null
          match_confidence: string | null
          name: string | null
          offer_count: number | null
          quantity: number | null
          sales_rank: number | null
          sales_rank_category: string | null
          sku: string | null
          source: string | null
          status: string | null
          user_id: string | null
          was_price_90d: number | null
          your_price: number | null
          your_qty: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tracked_asins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_platform_activity: {
        Row: {
          activity_date: string | null
          items_listed: number | null
          items_sold: number | null
          listing_value: number | null
          platform: string | null
          sold_value: number | null
          user_id: string | null
        }
        Relationships: []
      }
      ebay_sku_issues: {
        Row: {
          created_at: string | null
          ebay_data: Json | null
          id: string | null
          issue_type: string | null
          listing_status: string | null
          platform_item_id: string | null
          platform_sku: string | null
          price: number | null
          quantity: number | null
          sku_count: number | null
          title: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_listings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items_with_age: {
        Row: {
          age_bracket: string | null
          amazon_asin: string | null
          condition: string | null
          cost: number | null
          created_at: string | null
          days_in_stock: number | null
          id: string | null
          item_name: string | null
          linked_lot: string | null
          listing_date: string | null
          listing_platform: string | null
          listing_value: number | null
          notes: string | null
          purchase_date: string | null
          set_number: string | null
          sheets_synced_at: string | null
          sku: string | null
          source: string | null
          status: string | null
          storage_location: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          age_bracket?: never
          amazon_asin?: string | null
          condition?: string | null
          cost?: number | null
          created_at?: string | null
          days_in_stock?: never
          id?: string | null
          item_name?: string | null
          linked_lot?: string | null
          listing_date?: string | null
          listing_platform?: string | null
          listing_value?: number | null
          notes?: string | null
          purchase_date?: string | null
          set_number?: string | null
          sheets_synced_at?: string | null
          sku?: string | null
          source?: string | null
          status?: string | null
          storage_location?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          age_bracket?: never
          amazon_asin?: string | null
          condition?: string | null
          cost?: number | null
          created_at?: string | null
          days_in_stock?: never
          id?: string | null
          item_name?: string | null
          linked_lot?: string | null
          listing_date?: string | null
          listing_platform?: string | null
          listing_value?: number | null
          notes?: string | null
          purchase_date?: string | null
          set_number?: string | null
          sheets_synced_at?: string | null
          sku?: string | null
          source?: string | null
          status?: string | null
          storage_location?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_platform_summary: {
        Row: {
          items_listed: number | null
          items_sold: number | null
          listing_value: number | null
          month: string | null
          month_start: string | null
          platform: string | null
          sold_value: number | null
          user_id: string | null
        }
        Relationships: []
      }
      platform_performance_view: {
        Row: {
          avg_order_value: number | null
          month: string | null
          order_count: number | null
          platform: string | null
          total_fees: number | null
          total_profit: number | null
          total_revenue: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_roi_view: {
        Row: {
          items_count: number | null
          items_sold: number | null
          mileage: number | null
          mileage_cost: number | null
          purchase_cost: number | null
          purchase_date: string | null
          purchase_id: string | null
          revenue_from_sold: number | null
          short_description: string | null
          source: string | null
          total_item_cost: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      calculate_days_in_stock: {
        Args: { created_at: string; purchase_date: string }
        Returns: number
      }
      get_uk_financial_year: { Args: { input_date: string }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
