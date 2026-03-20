import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  esbuild: {
    target: 'esnext',
    platform: 'node',
    format: 'esm',
  },
  test: {
    // Environment
    environment: 'node',
    
    // Timeouts
    testTimeout: 30000,  // 30s for network calls
    hookTimeout: 10000,   // 10s for setup/teardown
    
    // Globals
    globals: true,
    
    // Enable TypeScript
    typecheck: {
      enabled: false,
    },
    
    // Pool options for better compatibility
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    
    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'src/**/*.ts',
        'ui/src/**/*.ts',
        'packages/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/node_modules/**',
        '**/dist/**',
        '**/.svelte-kit/**',
        '**/build/**',
      ],
      all: true,
      clean: true,
      // Thresholds
      lines: 60,
      functions: 60,
      branches: 60,
      statements: 60,
    },
    
    // Reporters
    reporters: ['verbose'],
    
    // Test setup
    setupFiles: [],
    
    // File patterns
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    
    // Parallelization
    threads: true,
    maxThreads: 4,
    minThreads: 1,
    
    // Retry failed tests
    retry: 1,
  },
  
  // Resolve
  resolve: {
    alias: {
      '$lib': path.resolve(__dirname, './ui/src/lib'),
      '$src': path.resolve(__dirname, './src'),
    },
    extensions: ['.ts', '.js', '.json'],
  },
});
