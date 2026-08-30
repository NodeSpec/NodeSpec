import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@nodespec/core': new URL('./core/src', import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
