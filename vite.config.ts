import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import aitDevtools from '@apps-in-toss/devtools/unplugin';

export default defineConfig({
  // 상대 경로로 빌드해요 — GitHub Pages(/저장소이름/)와 토스 미니앱(루트) 어디에 올려도 그대로 동작해요
  base: './',
  // aitDevtools: 개발 서버에서 화면 오른쪽 아래 AIT 버튼으로 토스 환경을 흉내 내 볼 수 있어요
  plugins: [aitDevtools.vite(), react()],
  // 다른 프로젝트와 포트가 겹치지 않도록 고정
  server: { host: true, port: 5288, strictPort: true },
});
