import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/'],
    },
    // Memory optimization for large test suites (2500+ tests)
    // Use forks pool for process isolation
    pool: 'forks',
    maxWorkers: 2, // Parallel workers for speed
    fileParallelism: true,
    isolate: true,
    testTimeout: 30000,
    // Disable watch mode by default
    watch: false,
    // Bail on first failure to avoid wasted memory
    bail: 0,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
