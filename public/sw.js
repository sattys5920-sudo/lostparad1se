// 정적 파일만 캐시한다. **게임 상태는 한 번도 캐시하지 않는다.**
//
// 눈 오는 학교는 지하철에서도 켠다. 주소창 없이 띄워 놓고 앱 전환을
// 하다 보면 껍데기부터 다시 받는 일이 잦은데, 그동안은 흰 화면이다.
// 껍데기만 미리 쥐고 있으면 그 흰 화면이 사라진다.
//
// 캐시하는 것과 안 하는 것을 가르는 기준은 하나다 —
// **내용이 바뀌면 이름도 바뀌는가.**
//
//   assets/*-<해시>.js   이름에 내용이 박혀 있다 → 캐시부터 본다
//   *.html               같은 이름으로 내용이 바뀐다 → 서버부터 본다
//   Firestore·Functions  게임 상태다 → 손대지 않는다
//
// 화면이 서버보다 새것인 창은 이미 한 번 검은 화면을 냈다. 서비스
// 워커가 옛 껍데기를 쥐고 있으면 그 창이 더 오래 산다 — 그래서
// html 은 언제나 서버가 먼저고, 새 워커는 기다리지 않고 곧장 넘겨받는다.
const CACHE = 'sc-static-v1'

self.addEventListener('install', (e) => {
  // 기다리지 않는다. 낡은 껍데기를 오래 쥐고 있을수록 손해다
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

/** 이름에 해시가 박힌 것만. 그 밖은 서버에 묻는다. */
function immutable(url) {
  return url.pathname.includes('/assets/') || url.pathname.startsWith('/lostparad1se/fonts/')
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // 남의 집은 건드리지 않는다 — Firestore도 Functions도 여기로 안 온다
  if (url.origin !== location.origin) return

  if (immutable(url)) {
    e.respondWith(
      (async () => {
        const hit = await caches.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone())
        return res
      })(),
    )
    return
  }

  // 껍데기와 그 밖의 것. **서버가 먼저다.** 못 닿을 때만 캐시를 꺼낸다
  e.respondWith(
    (async () => {
      try {
        const res = await fetch(req)
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone())
        return res
      } catch (err) {
        const hit = await caches.match(req)
        if (hit) return hit
        throw err
      }
    })(),
  )
})
