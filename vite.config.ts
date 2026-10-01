import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * 이번 빌드의 이름표. 화면에 박히고(__BUILD_ID__) version.json 으로도 나간다.
 * 떠 있는 화면이 version.json 을 가끔 물어서 다르면 「새로 고침」 띠를 띄운다 —
 * 폰이 옛 화면을 쥐고 있으면 배포해도 고친 게 안 보인다.
 */
const BUILD_ID = process.env.VITEST ? 'test' : new Date().toISOString()

// https://vite.dev/config/
export default defineConfig({
  // Firebase Hosting 이 뿌리에서 서빙한다: https://<프로젝트>.web.app/
  // (예전에는 GitHub Pages 의 /lostparad1se/ 아래였다 — 그 주소는 이제 여기로 넘긴다)
  base: '/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      name: 'version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) })
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        // 본 게임. 로그인 → 자리 → 닷새
        main: resolve(root, 'index.html'),
        // 규칙집. 게임 밖에서 여는 읽을거리 — 스크립트 없는 한 장이다
        rules: resolve(root, 'rules.html'),
        // 옛 주소로 들어온 사람을 뿌리로 넘기는 문지방. 테스터에게
        // 나눠 준 링크가 이 주소였다
        play: resolve(root, 'play.html'),
        // 아바타 부품 목록. 고를 수 있는 것을 한 장에 편다
        parts: resolve(root, 'parts.html'),
        // 검수용 페이지(proto·sprites·size·maptour·morning·archive·retro·host)는
        // 배포하지 않는다 — 진상·역할 이름·지도 전체가 그대로 보인다.
        // 개발 서버(npx vite)에서는 그대로 열린다
      },
    },
  },
})
