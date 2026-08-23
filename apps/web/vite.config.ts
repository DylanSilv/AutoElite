import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@autoelite/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // El panel habla con la API por el mismo origen: así la cookie del refresh
    // token no depende de configuración de CORS en desarrollo.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  // `vite preview` sirve el build real: sirve para probar los artefactos de
  // producción sin levantar los contenedores. En el despliegue, este proxy lo
  // hace nginx.
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
});
