import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages가 저장소 이름 아래로 서빙한다: /lostparad1se/
  base: '/lostparad1se/',
  plugins: [react()],
})
