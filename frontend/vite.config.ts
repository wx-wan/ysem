import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发服务器端口固定为 5001。
// 说明：macOS 系统服务 ControlCenter（AirPlay 接收器）常驻占用 5000，
//       为避免与系统服务冲突，本项目固定使用 5001。
// strictPort: 端口被占用时**明确报错退出**，不会静默切换到其他端口。
// 后端接入：仅通过 Vite dev proxy 转发 /api 到后端（前端请求统一使用相对路径 /api）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5001,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
