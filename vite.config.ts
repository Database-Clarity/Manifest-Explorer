import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Stable framework runtime that changes far less often than app code. Keeping
 * it in its own fingerprinted chunk lets browsers reuse the cached React
 * runtime across deploys instead of re-downloading it with the app bundle.
 */
const VENDOR_MODULE_RE = /\/node_modules\/(?:react|react-dom|scheduler|zustand)\//;

function splitVendorChunk(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, '/');
  return VENDOR_MODULE_RE.test(normalizedId) ? 'vendor' : undefined;
}

function emitVersionJsonPlugin(buildId: string): Plugin {
  return {
    name: 'emit-version-json',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl =
          'url' in request && typeof request.url === 'string' ? request.url : '/';
        const pathname = new URL(requestUrl, 'http://localhost').pathname;
        if (!pathname.endsWith('/version.json')) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        response.end(JSON.stringify({ buildId }));
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(
          { buildId, builtAt: new Date().toISOString() },
          null,
          2,
        ),
      });
    },
  };
}

export default defineConfig(({ command }) => {
  const buildId =
    command === 'build'
      ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      : 'dev';

  return {
    base: '/',
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildId),
    },
    plugins: [react(), emitVersionJsonPlugin(buildId)],
    worker: {
      format: 'es',
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: splitVendorChunk,
        },
      },
    },
  };
});
