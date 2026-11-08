import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 다른 프로젝트와 포트가 겹치지 않도록 고정
  server: { host: true, port: 5288, strictPort: true },
});
