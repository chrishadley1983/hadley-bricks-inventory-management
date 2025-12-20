import { Package } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30">
      <div className="w-full max-w-md space-y-6 p-6">
        <div className="flex flex-col items-center space-y-2">
          <Package className="h-12 w-12 text-primary" />
          <h1 className="text-2xl font-bold">Hadley Bricks</h1>
          <p className="text-sm text-muted-foreground">Inventory Management System</p>
        </div>
        {children}
      </div>
    </div>
  );
}
