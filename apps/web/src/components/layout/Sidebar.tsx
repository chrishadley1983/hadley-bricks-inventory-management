'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Home,
  Package,
  ShoppingCart,
  FileText,
  // Settings, // Commented out - Settings link removed from sidebar
  TrendingUp,
  Clock,
  Upload,
  ExternalLink,
  // RefreshCw, // Commented out - used by Data Sync (currently disabled)
  BarChart3,
  Landmark,
  Link2,
  Search,
  CalendarDays,
  Layers,
  CloudUpload,
  Scale,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}

const mainNavItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/purchases', label: 'Purchases', icon: ShoppingCart },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/orders', label: 'Orders', icon: FileText },
  { href: '/transactions', label: 'Transactions', icon: Landmark },
  { href: '/set-lookup', label: 'Set Lookup', icon: Search },
  { href: '/bricklink-uploads', label: 'BrickLink Uploads', icon: Upload },
];

const reportNavItems: NavItem[] = [
  { href: '/reports', label: 'All Reports', icon: BarChart3 },
  { href: '/reports/profit-loss', label: 'Profit & Loss', icon: TrendingUp },
  { href: '/reports/daily-activity', label: 'Daily Activity', icon: CalendarDays },
  { href: '/reports/inventory-aging', label: 'Inventory Aging', icon: Clock },
];

const integrationNavItems: NavItem[] = [
  { href: '/settings/integrations', label: 'Platforms', icon: ExternalLink },
  { href: '/platform-stock', label: 'Amazon Stock', icon: Layers },
  { href: '/amazon-sync', label: 'Amazon Sync', icon: CloudUpload },
  { href: '/ebay-stock', label: 'eBay Stock', icon: Layers },
];

const arbitrageNavItems: NavItem[] = [
  { href: '/arbitrage/amazon', label: 'Amazon', icon: Scale },
  { href: '/arbitrage/ebay', label: 'eBay', icon: Scale },
  { href: '/arbitrage/vinted', label: 'Vinted', icon: Scale, disabled: true },
  { href: '/arbitrage/facebook', label: 'Facebook', icon: Scale, disabled: true },
];

// Commented out - Data Sync page not currently needed, but keeping code for future use
// Note: Monzo Transactions still links to Google Sheets - do not remove connection type code
// const adminNavItems: NavItem[] = [
//   { href: '/admin/sync', label: 'Data Sync', icon: RefreshCw },
//   { href: '/settings/inventory-resolution', label: 'Inventory Resolution', icon: Link2 },
// ];

const adminNavItems: NavItem[] = [
  { href: '/settings/inventory-resolution', label: 'Inventory Resolution', icon: Link2 },
];

export function Sidebar() {
  const pathname = usePathname();

  const NavLink = ({ item }: { item: NavItem }) => {
    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
    const Icon = item.icon;

    if (item.disabled) {
      return (
        <span
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground/50 cursor-not-allowed"
          title="Coming soon"
        >
          <Icon className="h-4 w-4" />
          {item.label}
        </span>
      );
    }

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
            Arbitrage Tracker
          </h3>
          <div className="space-y-1">
            {arbitrageNavItems.map((item) => (
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
    </aside>
  );
}
