import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  resolve: {
    alias: {
      '@nodespec/core': new URL('./core/src', import.meta.url).pathname,
    },
  },
  plugins: [react()],
  optimizeDeps: {
    // Prebundle the UMD elkjs build deterministically so dev servers
    // (including WebContainer-based previews) interop it as ESM.
    include: ['elkjs/lib/elk.bundled.js'],
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
