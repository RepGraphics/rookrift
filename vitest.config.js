import { mergeConfig } from 'vite';
import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config.js';
export default mergeConfig(viteConfig({ mode: 'test' }), defineConfig({ test: { environment: 'happy-dom', include: ['test/*.ui.test.jsx'], globals: true } }));
