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
const CACHE = 'sc-static-v3'

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
  return url.pathname.includes('/assets/') || url.pathname.startsWith('/fonts/')
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

// ── 앱 밖 알림(웹 푸시) ──────────────────────────────────────────
//
// 서버(functions/src/notify.ts)가 보낸다. **내용은 없다** — 「새 공지」,
// 「팀 무전에서 누가 나를 불렀다」 같은 한 줄뿐이다. 같은 종류는 tag 로
// 한 칸에 겹친다. 누르면 그 화면(?tab=…)으로 연다 — 이미 열린 창이 있으면 그 창으로.
self.addEventListener('push', (e) => {
  let d = {}
  try {
    d = e.data ? e.data.json() : {}
  } catch {
    d = { body: e.data ? e.data.text() : '' }
  }
  const title = d.title || '투명인간'
  e.waitUntil(
    (async () => {
      if (typeof d.badge === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
        try {
          await self.navigator.setAppBadge(d.badge)
        } catch {
          /* 배지를 못 다는 기기 */
        }
      }
      await self.registration.showNotification(title, {
        body: d.body || '',
        tag: d.tag || 'note',
        renotify: true,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: d.url || '/' },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL((e.notification.data && e.notification.data.url) || '/', location.origin).href
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const w of wins) {
        if (new URL(w.url).origin === location.origin) {
          // 열린 창에게 어디로 갈지 알리고 앞으로 가져온다
          w.postMessage({ kind: 'open-tab', url })
          return w.focus()
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})
