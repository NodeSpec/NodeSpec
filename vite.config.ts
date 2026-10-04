import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Audit (owner 2026-09-27): Google Analytics is on the managed builds only
 *  (Free, Indie and Team on nodespec.io). The tag is added at build time
 *  when the edition is hosted and a measurement id is set, both from
 *  netlify.toml's production context; the open source, Enterprise and
 *  Government builds carry neither the tag nor the id. */
export function managedAnalytics(env: Record<string, string | undefined>): Plugin {
  const id = (env.VITE_GA_MEASUREMENT_ID ?? '').trim();
  const on = env.VITE_NODESPEC_EDITION === 'hosted' && /^G-[A-Z0-9]+$/.test(id);
  return {
    name: 'nodespec-managed-analytics',
    transformIndexHtml() {
      if (!on) return [];
      return [
        { tag: 'script', attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${id}` }, injectTo: 'head' },
        {
          tag: 'script',
          children: `window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', '${id}');`,
          injectTo: 'head',
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@nodespec/core': new URL('./core/src', import.meta.url).pathname,
    },
  },
  plugins: [react(), managedAnalytics(loadEnv(mode, process.cwd(), 'VITE_'))],
  optimizeDeps: {
    // Prebundle the UMD elkjs build deterministically so dev servers
    // (including WebContainer-based previews) interop it as ESM.
    include: ['elkjs/lib/elk.bundled.js'],
  },
  test: {
    globals: true,
    environment: 'node',
  },
}));
