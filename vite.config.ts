import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The dev server proxies /api + /events to the local harnessview node server
// (default :4317). In production the node server serves dist/ui directly, so
// no proxy is needed there.
const SERVER_PORT = process.env.HV_PORT || '4317';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
  },
  server: {
    port: 5317,
    proxy: {
      '/api': `http://localhost:${SERVER_PORT}`,
      '/events': {
        target: `http://localhost:${SERVER_PORT}`,
        ws: false,
      },
    },
  },
});
