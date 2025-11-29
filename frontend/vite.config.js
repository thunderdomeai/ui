import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Simple Vite config; the FastAPI app serves the built assets from ui/frontend/dist.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist'
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/thunderagents': {
        target: 'https://thunderagents-497847265153.us-central1.run.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/thunderagents/, '')
      }
    }
  }
});

