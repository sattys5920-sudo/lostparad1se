// 알림 — 보낼지 말지를 **전부 여기서** 정한다.
//
//   앱 안     games/{판}/inbox/{사람}.notes 에 한 줄을 얹는다(최근 20줄).
//             본인만 읽는 문서라 화면이 구독하다가 배너를 띄운다
//   앱 밖     웹 푸시. 기기마다 구독이 따로 있다(secret/pushSubs). 죽은 구독은 지운다
//
// 종류 · 문구 · 기본값 · 조용한 시간은 shared/notify/notifyData.ts 에 있다.
// **알림에는 내용을 안 싣는다** — 태그는 무슨 말인지, 페이즈 종료는 결과를,
// 공지는 본문을 안 싣는다.
//
// 지키는 것
//   같은 알림 두 번     dedupe 키로 한 번만(secret/notifyKeys)
//   몰아치기            한 사람에게 1분에 다섯 건을 넘으면 「알림 n건」 한 줄로 묶는다
//   조용한 시간         00:00~08:00(서울) 에는 앱 밖으로 안 보낸다. 제작 완료만 08:00 에 모아 보낸다
//   기록                종류 · 받는 사람 · 시각 · 길(앱 안/밖) · 성공 여부(secret/notifyLog)
import { createHash } from 'node:crypto'

import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore } from 'firebase-admin/firestore'
import webpush from 'web-push'

import {
  ARCHIVE_MAX,
  BURST_PER_MINUTE,
  NOTIFY_LINK,
  NOTIFY_TEXT,
  NOTIFY_TYPES,
  PUSH_TITLE,
  burstText,
  isQuiet,
  madeBatchText,
  quietEndsAt,
  settingsOf,
  type NoteItem,
  type NotifySettings,
  type NotifyType,
} from '../../shared/notify/notifyData'
import type { InboxDoc } from '../../shared/missions/mail'

import { requireHost } from './host'
import { gameRef, requireUid } from './index'

const db = getFirestore()

const inboxOf = (gameId: string) => gameRef(gameId).collection('inbox')
const secretOf = (gameId: string, name: string) => gameRef(gameId).collection('secret').doc(name).collection('items')
/** 조용한 시간에 미뤄 둔 제작 완료. 판을 가리지 않고 08:00 에 한 번에 턴다 */
const queue = () => db.collection('notifyQueue')

// ── 웹 푸시 열쇠 ─────────────────────────────────────────────────
//
// 배포할 때 functions/.env 로 들어온다(deploy-functions.yml). 없으면 앱 밖
// 알림만 조용히 빠지고 기록에 「열쇠 없음」이 남는다 — 앱 안 알림은 그대로 간다.
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noreply@example.com'
const canPush = VAPID_PUBLIC.length > 0 && VAPID_PRIVATE.length > 0
if (canPush) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

interface PushSubDoc {
  uid: string
  endpoint: string
  keys: { p256dh: string; auth: string }
  atMs: number
}

interface LogDoc {
  type: NotifyType | 'batch'
  target: string
  atMs: number
  channel: 'app' | 'push'
  ok: boolean
  err?: string
  /** 보낼 길이 없어서 안 보냈다(구독 없음 · 열쇠 없음). 실패로 안 센다 */
  skip?: boolean
  key: string
}

const subId = (endpoint: string) => createHash('sha1').update(endpoint).digest('hex')
const keyId = (key: string) => createHash('sha1').update(key).digest('hex')

async function log(gameId: string, row: LogDoc): Promise<void> {
  await secretOf(gameId, 'notifyLog').add(row)
}

/** 한 사람의 기기 전부에 보낸다. 죽은 구독(404 · 410)은 지운다 */
async function pushTo(
  gameId: string,
  uid: string,
  body: { text: string; type: NotifyType | 'batch'; link: string; badge: number },
  key: string,
): Promise<void> {
  const atMs = Date.now()
  if (!canPush) {
    await log(gameId, { type: body.type, target: uid, atMs, channel: 'push', ok: false, err: '열쇠 없음', skip: true, key })
    return
  }
  const subs = await secretOf(gameId, 'pushSubs').where('uid', '==', uid).get()
  if (subs.empty) {
    await log(gameId, { type: body.type, target: uid, atMs, channel: 'push', ok: false, err: '구독 없음', skip: true, key })
    return
  }
  const payload = JSON.stringify({
    title: PUSH_TITLE,
    body: body.text,
    // 같은 종류는 한 칸에 겹친다 — 페이즈 알림 열 개가 줄지어 쌓이지 않는다
    tag: body.type,
    url: `/?tab=${body.link}`,
    badge: body.badge,
  })
  await Promise.all(
    subs.docs.map(async (d) => {
      const s = d.data() as PushSubDoc
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 3600 })
        await log(gameId, { type: body.type, target: uid, atMs, channel: 'push', ok: true, key })
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode ?? 0
        if (code === 404 || code === 410) await d.ref.delete()
        await log(gameId, { type: body.type, target: uid, atMs, channel: 'push', ok: false, err: `${code || (e as Error).message}`.slice(0, 120), key })
      }
    }),
  )
}

/**
 * 알린다. **보낼지 말지는 받는 사람의 설정과 여기 규칙이 정한다.**
 *
 * @param key 같은 일로 두 번 불러도 한 번만 간다. 받는 사람마다 따로 센다
 */
export async function notify(gameId: string, targets: readonly string[], type: NotifyType, key: string): Promise<void> {
  const uniq = [...new Set(targets)].filter(Boolean)
  await Promise.all(uniq.map((uid) => notifyOne(gameId, uid, type, key).catch((e) => console.error('notify', type, e))))
}

async function notifyOne(gameId: string, uid: string, type: NotifyType, key: string): Promise<void> {
  const nowMs = Date.now()
  const fullKey = `${key}:${uid}`
  const inboxRef = inboxOf(gameId).doc(uid)
  const keyRef = secretOf(gameId, 'notifyKeys').doc(keyId(fullKey))
  const rateRef = secretOf(gameId, 'notifyRate').doc(uid)

  const out = await db.runTransaction(async (tx) => {
    const [had, inbox, rate] = await Promise.all([tx.get(keyRef), tx.get(inboxRef), tx.get(rateRef)])
    if (had.exists) return null
    tx.create(keyRef, { atMs: nowMs })
    const box = (inbox.data() ?? {}) as InboxDoc
    const settings = settingsOf(box.settings)
    const mode = settings.on ? settings.modes[type] : 'off'
    if (mode === 'off') return { mode, burst: false, unread: 0 }

    // 1분 창. 창 안에서 다섯 건을 넘으면 맨 위 줄을 「알림 n건」으로 바꿔 센다
    const r = (rate.data() ?? {}) as { fromMs?: number; n?: number }
    const fresh = !r.fromMs || nowMs - r.fromMs >= 60_000
    const n = fresh ? 1 : (r.n ?? 0) + 1
    tx.set(rateRef, { fromMs: fresh ? nowMs : r.fromMs, n })
    const notes = [...(box.notes ?? [])]
    const burst = n > BURST_PER_MINUTE
    if (burst && notes[0]?.id === `burst-${r.fromMs}`) {
      const c = (notes[0].count ?? 1) + 1
      notes[0] = { ...notes[0], text: burstText(c), count: c, atMs: nowMs }
    } else if (burst) {
      notes.unshift({ id: `burst-${r.fromMs}`, type, text: burstText(1), link: NOTIFY_LINK[type], atMs: nowMs, count: 1 })
    } else {
      notes.unshift({ id: keyId(fullKey).slice(0, 12), type, text: NOTIFY_TEXT[type], link: NOTIFY_LINK[type], atMs: nowMs } satisfies NoteItem)
    }
    const kept = notes.slice(0, ARCHIVE_MAX)
    tx.set(inboxRef, { notes: kept }, { merge: true })
    const readTo = box.notesReadAtMs ?? 0
    return { mode, burst, unread: kept.filter((x) => x.atMs > readTo).length }
  })
  if (!out || out.mode === 'off') return
  await log(gameId, { type, target: uid, atMs: nowMs, channel: 'app', ok: true, key })
  // 묶이기 시작하면 앱 밖으로는 더 안 보낸다 — 주머니가 1분 내내 떨지 않게
  if (out.mode !== 'push' || out.burst) return
  if (isQuiet(nowMs)) {
    // 조용한 시간. 제작 완료만 끝나는 시각에 모아 보낸다 — 나머지는 앱 안에만 남는다
    if (type === 'made') await queue().add({ gameId, uid, dueAtMs: quietEndsAt(nowMs), atMs: nowMs })
    return
  }
  await pushTo(gameId, uid, { text: NOTIFY_TEXT[type], type, link: NOTIFY_LINK[type], badge: out.unread }, fullKey)
}

/** 미뤄 둔 제작 완료를 턴다 — 사람마다 한 줄로 묶어서 */
export async function flushQueue(nowMs = Date.now()): Promise<number> {
  const due = await queue().where('dueAtMs', '<=', nowMs).get()
  const groups = new Map<string, { gameId: string; uid: string; n: number }>()
  for (const d of due.docs) {
    const q = d.data() as { gameId: string; uid: string }
    const k = `${q.gameId}/${q.uid}`
    const g = groups.get(k) ?? { gameId: q.gameId, uid: q.uid, n: 0 }
    g.n += 1
    groups.set(k, g)
  }
  await Promise.all(
    [...groups.values()].map((g) =>
      pushTo(g.gameId, g.uid, { text: madeBatchText(g.n), type: 'made', link: NOTIFY_LINK.made, badge: g.n }, `queue:${nowMs}:${g.uid}`),
    ),
  )
  const batch = db.batch()
  for (const d of due.docs) batch.delete(d.ref)
  await batch.commit()
  return groups.size
}

/** 서울 08:00 — 조용한 시간이 끝나면 미뤄 둔 것을 보낸다. 예약 작업은 이것 하나다 */
export const notifyMorning = onSchedule({ schedule: '0 8 * * *', timeZone: 'Asia/Seoul', region: 'asia-northeast3' }, async () => {
  await flushQueue()
})

// ── 참가자가 부르는 것 ───────────────────────────────────────────

/** 앱 밖 알림을 켤 때 쓰는 공개 열쇠. 없으면 빈 문자열 — 화면이 「앱 밖」 칸을 막는다 */
export const notifyConfig = onCall(async () => ({ publicKey: VAPID_PUBLIC }))

/** 알림 설정. **내 것만.** 모르는 값은 기본값으로 */
export const setNotifySettings = onCall<{ gameId: string; settings: Partial<NotifySettings> }>(async (req) => {
  const uid = requireUid(req.auth)
  const settings = settingsOf(req.data.settings)
  await inboxOf(req.data.gameId).doc(uid).set({ settings }, { merge: true })
  return { settings }
})

/** 이 기기를 앱 밖 알림에 건다. 같은 기기는 한 줄이다 */
export const pushSubscribe = onCall<{ gameId: string; sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }>(async (req) => {
  const uid = requireUid(req.auth)
  const s = req.data.sub ?? {}
  const endpoint = String(s.endpoint ?? '')
  const p256dh = String(s.keys?.p256dh ?? '')
  const auth = String(s.keys?.auth ?? '')
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) throw new HttpsError('invalid-argument', '구독이 이상하다.')
  const doc: PushSubDoc = { uid, endpoint, keys: { p256dh, auth }, atMs: Date.now() }
  await secretOf(req.data.gameId, 'pushSubs').doc(subId(endpoint)).set(doc)
  return { ok: true }
})

/** 이 기기를 뗀다. 남의 구독은 못 뗀다 */
export const pushUnsubscribe = onCall<{ gameId: string; endpoint: string }>(async (req) => {
  const uid = requireUid(req.auth)
  const ref = secretOf(req.data.gameId, 'pushSubs').doc(subId(String(req.data.endpoint ?? '')))
  const snap = await ref.get()
  if (snap.exists && (snap.data() as PushSubDoc).uid === uid) await ref.delete()
  return { ok: true }
})

/** 보관함을 열었다 — 점을 지운다 */
export const readNotes = onCall<{ gameId: string }>(async (req) => {
  const uid = requireUid(req.auth)
  await inboxOf(req.data.gameId).doc(uid).set({ notesReadAtMs: Date.now() }, { merge: true })
  return { ok: true }
})

// ── 운영자 ───────────────────────────────────────────────────────

/** 보낸 기록 — 최근 200줄과 종류 · 길별 실패 수 */
export const hostNotifyLog = onCall<{ gameId: string }>(async (req) => {
  requireHost(req.auth)
  const snap = await secretOf(req.data.gameId, 'notifyLog').orderBy('atMs', 'desc').limit(200).get()
  const rows = snap.docs.map((d) => d.data() as LogDoc)
  const game = (await gameRef(req.data.gameId).get()).data() as { seats?: { playerId: string; name: string }[] } | undefined
  const nameOf = (id: string) => game?.seats?.find((s) => s.playerId === id)?.name ?? ''
  const fails: Record<string, { app: number; push: number }> = {}
  for (const t of [...NOTIFY_TYPES, 'batch']) fails[t] = { app: 0, push: 0 }
  let skipped = 0
  for (const r of rows) {
    if (r.skip) skipped += 1
    else if (!r.ok) fails[r.type][r.channel] += 1
  }
  const subs = await secretOf(req.data.gameId, 'pushSubs').count().get()
  return {
    canPush,
    skipped,
    devices: subs.data().count,
    fails,
    rows: rows.map((r) => ({ ...r, name: nameOf(r.target) })),
  }
})
