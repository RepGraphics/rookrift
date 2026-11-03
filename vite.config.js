import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __DEMO__: JSON.stringify(mode === 'demo' || mode === 'test') },
  test: { environment: 'happy-dom', include: ['test/*.ui.test.jsx'], globals: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3000', '/auth': 'http://127.0.0.1:3000' } },
  build: { outDir: 'dist' }
}));
