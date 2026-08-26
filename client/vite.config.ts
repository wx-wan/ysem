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
        // SSE 实时推送：禁用代理缓冲，确保事件流即时转发到前端
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const ct = proxyRes.headers['content-type'] || '';
            if (ct.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
              proxyRes.headers['x-accel-buffering'] = 'no';
              // http-proxy 默认对 streaming 响应即时转发，这里显式 flush 头
              if (typeof (proxyRes as any).flushHeaders === 'function') {
                (proxyRes as any).flushHeaders();
              }
            }
          });
        },
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
