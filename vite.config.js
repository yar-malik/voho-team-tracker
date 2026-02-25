import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    // allow our workflow host for development
    allowedHosts: ['teamvoho.openaiworkflows.com'],
  },
});
