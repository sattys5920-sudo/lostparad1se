// 감독관 — 시작 전 잠금과 탭 잠금.
//
// 가입 · 아바타 · 프롤로그를 마친 사람은 **아무것도 못 하고 기다린다.**
// 감독관이 「대화 · 이동 풀기」를 누르면 2-3 교실 안에서 걷고 말한다.
// 「판 시작」을 누르면 전부 열린다.
//
// 탭 잠금은 판이 도는 동안 감독관이 탭 하나씩 잠그고 연다.
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import { gameRef } from './index'
import { requireHost } from './host'
import type { GameDoc } from '../../shared/model'

/** 잠글 수 있는 탭. 화면(Play.tsx 의 Tab)과 같은 이름이다 */
export const LOCKABLE_TABS = ['map', 'me', 'radio', 'vote', 'note'] as const

export const hostSetLobbyStage = onCall<{ gameId: string; stage: 'locked' | 'talk' }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const stage = req.data.stage === 'talk' ? 'talk' : 'locked'
  const ref = gameRef(gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  if ((snap.data() as GameDoc).phase !== 'lobby') throw new HttpsError('failed-precondition', '판이 이미 시작됐다.')
  await ref.update({ lobbyStage: stage })
  return { stage }
})

/**
 * 배경음악을 틀고 끈다. **틀면 꺼 둔 사람도 다시 켜진다** — atMs 가 새로
 * 적히고, 각자 끈 시각이 그보다 앞이면 켜진 것으로 본다(화면의 bgm.ts).
 *
 * **곡은 감독관이 고른다(1~4).** 전에는 날마다 곡이 저절로 바뀌었다. 곡을
 * 안 주면 틀어 두었던 곡을 그대로 둔다.
 */
export const hostSetBgm = onCall<{ gameId: string; on: boolean; track?: number }>(async (req) => {
  requireHost(req.auth)
  const { gameId } = req.data
  const ref = gameRef(gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const asked = Number(req.data.track)
  if (req.data.track !== undefined && !(Number.isInteger(asked) && asked >= 1 && asked <= 4)) {
    throw new HttpsError('invalid-argument', '곡은 1~4 번이다.')
  }
  const before = (snap.data() as GameDoc).bgm?.track
  const track = req.data.track !== undefined ? asked : (before ?? 1)
  const bgm = { on: req.data.on === true, atMs: Date.now(), track }
  await ref.update({ bgm })
  return { bgm }
})

export const hostSetTabLock = onCall<{ gameId: string; tab: string; locked: boolean }>(async (req) => {
  requireHost(req.auth)
  const { gameId, tab } = req.data
  if (!(LOCKABLE_TABS as readonly string[]).includes(tab)) throw new HttpsError('invalid-argument', '그런 탭이 없다.')
  const ref = gameRef(gameId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '그런 판이 없다.')
  const now = new Set((snap.data() as GameDoc).lockedTabs ?? [])
  if (req.data.locked === true) now.add(tab)
  else now.delete(tab)
  const lockedTabs = LOCKABLE_TABS.filter((t) => now.has(t))
  await ref.update({ lockedTabs })
  return { lockedTabs }
})
