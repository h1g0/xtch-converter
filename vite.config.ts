import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  // Relative asset paths so dist/ can be hosted from any sub-path.
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  worker: { format: 'es' },
});
