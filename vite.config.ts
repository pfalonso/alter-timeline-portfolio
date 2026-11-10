import { defineConfig } from 'vite';
import { personalDataPlugin } from './build/personalDataPlugin.ts';

export default defineConfig({
  plugins: [personalDataPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
    // Nada de data: URIs — la CSP solo permite fuentes e imágenes propias.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
  server: { host: true },
  preview: { host: true, port: 4173 },
});
