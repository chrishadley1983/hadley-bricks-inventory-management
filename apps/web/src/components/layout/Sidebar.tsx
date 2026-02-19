'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  Calculator,
  PenLine,
  ClipboardList,
  ChevronDown,
  LineChart,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}

interface NavSection {
  id: string;
  title: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

const mainNavItems: NavItem[] = [
  { href: '/workflow', label: 'Workflow', icon: ClipboardList },
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/purchases', label: 'Purchases', icon: ShoppingCart },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/orders', label: 'Orders', icon: FileText },
  { href: '/transactions', label: 'Transactions', icon: Landmark },
  { href: '/set-lookup', label: 'Set Lookup', icon: Search },
  { href: '/purchase-evaluator', label: 'Purchase Evaluator', icon: Calculator },
  { href: '/listing-assistant', label: 'Listing Assistant', icon: PenLine },
  { href: '/bricklink-uploads', label: 'BrickLink Uploads', icon: Upload },
];

const navSections: NavSection[] = [
  {
    id: 'reports',
    title: 'Reports',
    defaultOpen: true,
    items: [
      { href: '/reports', label: 'All Reports', icon: BarChart3 },
      { href: '/reports/profit-loss', label: 'Profit & Loss', icon: TrendingUp },
      { href: '/cost-modelling', label: 'Cost Modelling', icon: Calculator },
      { href: '/reports/daily-activity', label: 'Daily Activity', icon: CalendarDays },
      { href: '/reports/inventory-aging', label: 'Inventory Aging', icon: Clock },
    ],
  },
  {
    id: 'investment',
    title: 'Investment',
    defaultOpen: false,
    items: [
      { href: '/investment', label: 'Investment Tracker', icon: LineChart },
      { href: '/investment/top-picks', label: 'Top Picks', icon: TrendingUp },
    ],
  },
  {
    id: 'integrations',
    title: 'Integrations',
    defaultOpen: true,
    items: [
      { href: '/settings/integrations', label: 'Platforms', icon: ExternalLink },
      { href: '/platform-stock', label: 'Amazon Stock', icon: Layers },
      { href: '/amazon-sync', label: 'Amazon Sync', icon: CloudUpload },
      { href: '/ebay-stock', label: 'eBay Stock', icon: Layers },
      { href: '/minifigs', label: 'Minifig Sync', icon: CloudUpload },
      { href: '/minifigs/review', label: 'Minifig Review', icon: CloudUpload },
      { href: '/minifigs/removals', label: 'Minifig Removals', icon: Layers },
    ],
  },
  {
    id: 'arbitrage',
    title: 'Arbitrage Tracker',
    defaultOpen: false,
    items: [
      { href: '/arbitrage', label: 'Arbitrage', icon: Scale },
      { href: '/arbitrage/vinted', label: 'Vinted', icon: Scale },
    ],
  },
  {
    id: 'admin',
    title: 'Admin',
    defaultOpen: false,
    items: [
      { href: '/settings/inventory-resolution', label: 'Inventory Resolution', icon: Link2 },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  // Check if any item in a section is active
  const isSectionActive = (items: NavItem[]) => {
    return items.some(
      (item) => pathname === item.href || pathname.startsWith(item.href + '/')
    );
  };

  // Initialize section open states - open if has active item or defaultOpen
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    navSections.forEach((section) => {
      initial[section.id] = section.defaultOpen || isSectionActive(section.items);
    });
    return initial;
  });

  const toggleSection = (id: string) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

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

  const NavSectionComponent = ({ section }: { section: NavSection }) => {
    const isOpen = openSections[section.id];
    const hasActiveItem = isSectionActive(section.items);

    return (
      <Collapsible open={isOpen} onOpenChange={() => toggleSection(section.id)}>
        <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
          <span className={cn(hasActiveItem && 'text-foreground')}>{section.title}</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-1 pt-1">
          {section.items.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-4 flex-shrink-0">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <Package className="h-6 w-6 text-primary" />
          <span>Hadley Bricks</span>
        </Link>
      </div>

      <ScrollArea className="flex-1">
        <nav className="space-y-4 px-3 py-4">
          {/* Main navigation - always visible */}
          <div className="space-y-1">
            {mainNavItems.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </div>

          {/* Collapsible sections */}
          {navSections.map((section) => (
            <NavSectionComponent key={section.id} section={section} />
          ))}
        </nav>
      </ScrollArea>
    </aside>
  );
}
