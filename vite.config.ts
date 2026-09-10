import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages가 저장소 이름 아래로 서빙한다: /lostparad1se/
  base: '/lostparad1se/',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // 본 게임
        main: resolve(root, 'index.html'),
        // 걸어 다니는 학교 프로토타입 — 본 게임과 코드도 데이터도 섞이지 않는다
        proto: resolve(root, 'proto.html'),
      },
    },
  },
})
