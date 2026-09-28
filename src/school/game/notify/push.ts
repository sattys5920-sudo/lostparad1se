// 앱 밖 알림(웹 푸시)을 이 기기에 건다 · 뗀다.
//
// **권한은 사람이 「앱 밖에서도」를 누른 그 순간에만 묻는다.** 들어오자마자
// 묻는 창은 대부분 거절당하고, 한 번 거절하면 브라우저가 다시 안 묻는다.
//
// 아이폰은 홈 화면에 추가한 앱에서만 웹 푸시가 된다. 사파리 탭에서는
// PushManager 가 아예 없다 — 그때는 안내를 띄운다(IOS_GUIDE).

export type PushState =
  | 'ok' // 걸렸다
  | 'denied' // 브라우저가 막았다
  | 'iosInstall' // 아이폰 — 홈 화면에 추가해야 한다
  | 'unsupported' // 이 브라우저는 안 된다
  | 'noKey' // 서버에 열쇠가 없다
  | 'failed' // 그 밖

export const isIOS = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export const isStandalone = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches === true ||
  (navigator as unknown as { standalone?: boolean }).standalone === true

export const pushSupported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** 공개 열쇠(base64url)를 PushManager 가 받는 모양으로 */
export function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

interface PushActs {
  notifyConfig: () => Promise<unknown>
  pushSubscribe: (sub: unknown) => Promise<unknown>
  pushUnsubscribe: (endpoint: string) => Promise<unknown>
}

/** 이 기기를 건다. **누른 순간에 불러야 한다** — 권한 창이 그 손짓에 매인다 */
export async function enablePush(act: PushActs): Promise<PushState> {
  if (!pushSupported()) return isIOS() && !isStandalone() ? 'iosInstall' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (perm !== 'granted') return 'denied'
  try {
    const { publicKey } = (await act.notifyConfig()) as { publicKey?: string }
    if (!publicKey) return 'noKey'
    const reg = await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }))
    await act.pushSubscribe(sub.toJSON())
    return 'ok'
  } catch {
    return 'failed'
  }
}

/** 이 기기를 뗀다 — 「앱 밖」을 하나도 안 쓰게 되었을 때 */
export async function disablePush(act: PushActs): Promise<void> {
  if (!pushSupported()) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    await act.pushUnsubscribe(sub.endpoint)
    await sub.unsubscribe()
  } catch {
    /* 떼지 못해도 서버가 죽은 구독을 지운다 */
  }
}
