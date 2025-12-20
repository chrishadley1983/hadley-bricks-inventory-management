'use client';

import dynamic from 'next/dynamic';
import { Sidebar } from '@/components/layout';

// Dynamic import for SyncStatusProvider to avoid SSR issues
const SyncStatusProvider = dynamic(
  () => import('@/components/providers').then((mod) => ({ default: mod.SyncStatusProvider })),
  { ssr: false }
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SyncStatusProvider autoSyncOnMount={true}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-muted/30">{children}</main>
      </div>
    </SyncStatusProvider>
  );
}
