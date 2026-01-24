/**
 * Critical paths for deployment verification.
 * These are the business-critical routes that must work for the app to be functional.
 */

export interface CriticalPath {
  name: string;
  path: string;
  expect: string;
  timeout: number;
  requiresAuth: boolean;
}

export const criticalPaths: CriticalPath[] = [
  {
    name: 'Dashboard loads',
    path: '/',
    expect: 'page loads without error, main content visible',
    timeout: 10000,
    requiresAuth: true,
  },
  {
    name: 'Inventory page loads',
    path: '/inventory',
    expect: 'page loads, inventory table or empty state visible',
    timeout: 15000,
    requiresAuth: true,
  },
  {
    name: 'Orders page loads',
    path: '/orders',
    expect: 'page loads, orders list or empty state visible',
    timeout: 15000,
    requiresAuth: true,
  },
  {
    name: 'Single order view',
    path: '/orders',
    expect: 'order details load successfully when clicking an order',
    timeout: 10000,
    requiresAuth: true,
  },
];
