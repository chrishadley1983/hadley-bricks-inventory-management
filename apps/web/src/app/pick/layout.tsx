import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: 'noindex, nofollow',
};

export default function PickLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
