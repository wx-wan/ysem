import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    hmr: {
      overlay: false,
    },
    // 减少文件监听开销：忽略无关目录，避免 watch 进程扫描整个 node_modules
    watch: {
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
      usePolling: false,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  // 预构建依赖，避免每个请求重复编译，降低内存与 CPU 峰值
  optimizeDeps: {
    include: ['react', 'react-dom', 'antd', '@ant-design/icons'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
