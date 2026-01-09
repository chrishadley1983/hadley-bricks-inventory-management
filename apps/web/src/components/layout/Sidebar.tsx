'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Home,
  Package,
  ShoppingCart,
  FileText,
  Settings,
  TrendingUp,
  Clock,
  Upload,
  ExternalLink,
  RefreshCw,
  BarChart3,
  PieChart,
  Landmark,
  Link2,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const mainNavItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/purchases', label: 'Purchases', icon: ShoppingCart },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/orders', label: 'Orders', icon: FileText },
  { href: '/transactions', label: 'Transactions', icon: Landmark },
  { href: '/bricklink-uploads', label: 'BrickLink Uploads', icon: Upload },
];

const reportNavItems: NavItem[] = [
  { href: '/reports', label: 'All Reports', icon: BarChart3 },
  { href: '/reports/profit-loss', label: 'Profit & Loss', icon: TrendingUp },
  { href: '/reports/inventory-aging', label: 'Inventory Aging', icon: Clock },
  { href: '/reports/platform-performance', label: 'Platforms', icon: PieChart },
];

const integrationNavItems: NavItem[] = [
  { href: '/settings/integrations', label: 'Platforms', icon: ExternalLink },
  { href: '/integrations/import', label: 'Import Data', icon: Upload },
];

const adminNavItems: NavItem[] = [
  { href: '/admin/sync', label: 'Data Sync', icon: RefreshCw },
  { href: '/settings/inventory-resolution', label: 'Inventory Resolution', icon: Link2 },
];

export function Sidebar() {
  const pathname = usePathname();

  const NavLink = ({ item }: { item: NavItem }) => {
    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
    const Icon = item.icon;

    return (
      <Link
        href={item.href}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        <Icon className="h-4 w-4" />
        {item.label}
      </Link>
    );
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <Package className="h-6 w-6 text-primary" />
          <span>Hadley Bricks</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-6 px-3 py-4">
        <div className="space-y-1">
          {mainNavItems.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>

        <div>
          <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Reports
          </h3>
          <div className="space-y-1">
            {reportNavItems.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Integrations
          </h3>
          <div className="space-y-1">
            {integrationNavItems.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Admin
          </h3>
          <div className="space-y-1">
            {adminNavItems.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </div>
        </div>
      </nav>

      <div className="border-t p-3">
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
            pathname === '/settings' || pathname.startsWith('/settings/')
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
