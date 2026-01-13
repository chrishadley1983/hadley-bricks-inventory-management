'use client';

import { Loader2, Package, ShoppingCart } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { InventoryStockSummary } from '@/app/api/brickset/inventory-stock/route';

interface SetStockCardProps {
  stock: InventoryStockSummary | null;
  loading?: boolean;
  onCurrentStockClick?: () => void;
  onSoldStockClick?: () => void;
}

interface StockCountProps {
  label: string;
  newCount: number;
  usedCount: number;
  total: number;
  icon: React.ReactNode;
  onClick?: () => void;
  accentColor: string;
  loading?: boolean;
}

function StockCount({
  label,
  newCount,
  usedCount,
  total,
  icon,
  onClick,
  accentColor,
  loading,
}: StockCountProps) {
  const isClickable = onClick && !loading;

  return (
    <button
      onClick={onClick}
      disabled={!isClickable}
      className={`flex-1 rounded-lg border p-4 text-left transition-all ${
        isClickable
          ? `hover:border-${accentColor}-400 hover:shadow-sm cursor-pointer`
          : 'cursor-default'
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className={`text-${accentColor}-600`}>{icon}</div>
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-2">
          <Loader2 className={`h-5 w-5 animate-spin text-${accentColor}-600`} />
        </div>
      ) : (
        <>
          <div className={`text-3xl font-bold text-${accentColor}-600 mb-2`}>
            {total}
          </div>
          <div className="flex gap-2">
            <Badge variant="default" className="text-xs">
              {newCount} New
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {usedCount} Used
            </Badge>
          </div>
          {isClickable && (
            <div className={`text-xs text-${accentColor}-600 mt-2`}>
              Click for details
            </div>
          )}
        </>
      )}
    </button>
  );
}

export function SetStockCard({
  stock,
  loading,
  onCurrentStockClick,
  onSoldStockClick,
}: SetStockCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Package className="h-4 w-4" />
          Your Inventory
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4">
          <StockCount
            label="Current Stock"
            newCount={stock?.currentStock.new ?? 0}
            usedCount={stock?.currentStock.used ?? 0}
            total={stock?.currentStock.total ?? 0}
            icon={<Package className="h-5 w-5" />}
            onClick={onCurrentStockClick}
            accentColor="blue"
            loading={loading}
          />
          <StockCount
            label="Sold"
            newCount={stock?.soldStock.new ?? 0}
            usedCount={stock?.soldStock.used ?? 0}
            total={stock?.soldStock.total ?? 0}
            icon={<ShoppingCart className="h-5 w-5" />}
            onClick={onSoldStockClick}
            accentColor="green"
            loading={loading}
          />
        </div>
      </CardContent>
    </Card>
  );
}
