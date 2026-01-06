import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface DashboardState {
  excludeSold: boolean;
  setExcludeSold: (value: boolean) => void;
  toggleExcludeSold: () => void;
  platform: string | null;
  setPlatform: (platform: string | null) => void;
}

/**
 * Store for dashboard preferences
 * Persists to localStorage so settings are remembered
 */
export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      excludeSold: true, // Default to excluding sold items
      setExcludeSold: (value) => set({ excludeSold: value }),
      toggleExcludeSold: () => set((state) => ({ excludeSold: !state.excludeSold })),
      platform: null, // null means "All Platforms"
      setPlatform: (platform) => set({ platform }),
    }),
    {
      name: 'dashboard-preferences',
    }
  )
);
