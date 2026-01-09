# Merge Report: feature/amazon-inventory-linking

**Date:** 2026-01-09
**Branch:** `feature/amazon-inventory-linking`
**Merge Commit:** `0033e8c`
**Target:** `main`

## Summary

Successfully merged Amazon inventory linking feature to main.

## Changes

### Files Modified (8)
- `.claude/settings.local.json`
- `.gitignore`
- `apps/web/src/app/api/inventory/route.ts`
- `apps/web/src/components/layout/Sidebar.tsx`
- `apps/web/src/hooks/__tests__/use-inventory.test.tsx`
- `apps/web/src/lib/repositories/inventory.repository.ts`
- `apps/web/src/lib/services/order-fulfilment.service.ts`
- `packages/database/src/types.ts`

### Files Created (8)
- `apps/web/src/app/(dashboard)/settings/inventory-resolution/page.tsx`
- `apps/web/src/app/api/amazon/inventory-linking/process-historical/route.ts`
- `apps/web/src/app/api/amazon/resolution-queue/[id]/resolve/route.ts`
- `apps/web/src/app/api/amazon/resolution-queue/[id]/skip/route.ts`
- `apps/web/src/app/api/amazon/resolution-queue/route.ts`
- `apps/web/src/app/api/inventory/linked-orders/route.ts`
- `apps/web/src/lib/amazon/amazon-inventory-linking.service.ts`
- `supabase/migrations/20250114000001_amazon_inventory_linking.sql`

### Statistics
- **Lines Added:** ~3,041
- **Lines Removed:** ~5

## Feature Overview

### Amazon Inventory Linking Service
Core service that links Amazon order items to inventory when orders ship:
- ASIN-based matching with FIFO (First In, First Out) selection
- Automatic handling of multi-quantity orders
- Financial calculation from `amazon_transactions` table
- Two modes: Pick List (from fulfillment) and Non-Pick List (ASIN match)

### Resolution Queue
For orders that cannot be auto-linked:
- Manual resolution UI with suggested matches
- Score-based candidate ranking
- Skip and "No Inventory" options
- Auto-advance to next item after resolution

### Double-Link Prevention
Prevents inventory items from being linked to multiple orders:
- Service-level validation in `resolveQueueItem`
- Auto-process exclusion via `getLinkedInventoryIds()`
- UI "Already Linked" badge with disabled selection

### Unified Inventory Resolution Page
- Renamed from "eBay Resolution" to "Inventory Resolution"
- Tab-based UI for eBay and Amazon platforms
- Process Historical Orders with SSE progress streaming
- Include sold items option for legacy data linking

### Database Migration
- `amazon_inventory_resolution_queue` table with RLS policies
- `amazon_linked_at` and `amazon_link_method` columns on `order_items`
- `inventory_link_status` column on `platform_orders`
- `amazon_order_item_id` FK on `inventory_items`

## Post-Merge Verification

| Check | Status |
|-------|--------|
| TypeScript | PASS |
| ESLint | PASS |
| Push to origin | PASS |
| Branch cleanup | PASS |

## Notes

- Migration needs to be applied to cloud Supabase: `npm run db:push`
- Types should be regenerated after migration: `npm run db:types`
- The `any` casts in resolution-queue routes are temporary until types are regenerated
