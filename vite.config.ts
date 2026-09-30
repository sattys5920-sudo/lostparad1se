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
        // 걸어 다니는 학교 프로토타입 — 본 게임과 코드도 데이터도 섞이지 않는다
        proto: resolve(root, 'proto.html'),
        // 스프라이트 검수용. 게임 화면과 섞이지 않는 개발용 페이지다
        sprites: resolve(root, 'sprites.html'),
        // 아바타 부품 목록. 고를 수 있는 것을 한 장에 편다
        parts: resolve(root, 'parts.html'),
        // 캐릭터 크기 시안. 고를 것을 나란히 놓고 본다
        size: resolve(root, 'size.html'),
        // 방 검수용. 학교 전체를 카메라 없이 한 장에 편다
        maptour: resolve(root, 'maptour.html'),
        // 아침 등교 시퀀스 검수용. 본문은 가짜다 — 진짜는 서버에만 있다
        morning: resolve(root, 'morning.html'),
        // 기록 보관함·추리 노트 검수용
        archive: resolve(root, 'archive.html'),
        // 회고 검수용
        retro: resolve(root, 'retro.html'),
        // 운영자 도구 검수용
        host: resolve(root, 'host.html'),
      },
    },
  },
})
