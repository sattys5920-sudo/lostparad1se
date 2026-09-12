// 진짜 서버에 붙은 진상 공개 화면들.
//
// 검수용 미리보기(preview.tsx 들)와 짝이다. 저쪽은 가짜 문장으로 모양만
// 보고, 이쪽은 서버가 내려보낸 것만 그린다.
//
// **문장은 하나도 여기 없다.** 전부 서버에서 온다. 화면 코드에 A의
// 문장이 한 줄이라도 있으면 번들 누출 검사에 걸린다.
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Archive } from './Archive'
import { EndingSequence, type EndingData } from './EndingSequence'
import { MorningSequence, type DayFragment } from './MorningSequence'
import { Retrospective } from './Retrospective'
import { loadNote, saveNote } from './notesSync'
import { gameActions, useGame } from '../game/useGame'
import { auth, db } from '../../firebase'
import { buildArchive, type ArchiveItem } from '../../../shared/reveal/archive'
import { pendingDays } from '../../../shared/reveal/morning'
import type { DeductionNote } from '../../../shared/reveal/notes'
import { newPost, type RetroPost } from '../../../shared/reveal/retro'
import { TILE_BY_ID, type TileId } from '../../../shared/rules/board'
import { normalizeLook } from '../char/look'
import type { TeamId } from '../../../shared/rules/v2'
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore'

const uidNow = () => auth?.currentUser?.uid ?? null

/** 서버가 거절하면 그 말을 그대로 보인다. 화면이 문구를 지어내지 않는다. */
function Problem({ text }: { text: string }) {
  return <p className="sc-rv__problem">{text}</p>
}

// ── 아침 시퀀스 ─────────────────────────────────────────────────

/**
 * 아직 안 본 날을 날짜순으로 재생한다.
 *
 * 무엇을 볼지는 서버가 정한다 — releasedFragments가 열린 날만 주고,
 * 그중 내 몫(view.handledDays)에 없는 날만 재생한다.
 */
export function LiveMorning({ gameId, onDone }: { gameId: string; onDone?: () => void }) {
  const state = useGame(gameId)
  const act = useMemo(() => gameActions(gameId), [gameId])
  const [fragments, setFragments] = useState<DayFragment[] | null>(null)
  const [error, setError] = useState('')

  const handled = state.view?.handledDays ?? []

  useEffect(() => {
    let live = true
    act
      .releasedFragments()
      .then((r) => {
        if (live) setFragments((r as { fragments: DayFragment[] }).fragments)
      })
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [act])

  const todo = useMemo(() => {
    if (!fragments) return []
    const open = fragments.map((f) => f.day)
    const days = new Set(pendingDays(open, handled))
    return fragments.filter((f) => days.has(f.day))
  }, [fragments, handled])

  const finish = useCallback(
    async (r: { read: number[]; skipped: number[] }) => {
      await act.markMorning(r.read, r.skipped).catch((e) => setError((e as Error).message))
      onDone?.()
    },
    [act, onDone],
  )

  // 볼 것이 없으면 그냥 지나간다. 여기서 null만 돌려주면 아침 화면이
  // 영영 안 끝나서 오늘 화면으로 넘어가지 못한다
  useEffect(() => {
    if (fragments && todo.length === 0) onDone?.()
  }, [fragments, todo.length, onDone])

  if (error) return <Problem text={error} />
  if (!fragments || state.loading) return null
  if (todo.length === 0) return null

  return (
    <MorningSequence
      fragments={todo}
      invisibleNameByDay={invisibleNames(state)}
      snowLevel={state.game?.snow?.level ?? 5}
      onFinish={finish}
    />
  )
}

/** 날마다 지워진 사람의 **이름**. 판 문서에 있는 건 아이디라 자리를 바꾼다. */
function invisibleNames(state: ReturnType<typeof useGame>): Record<number, string | null> {
  const seats = state.game?.seats ?? []
  const nameOf = (id: string) => seats.find((s) => s.playerId === id)?.name ?? null
  const out: Record<number, string | null> = {}
  for (const [day, id] of Object.entries(state.game?.invisibleByDay ?? {})) {
    out[Number(day)] = id ? nameOf(id) : null
  }
  return out
}

// ── 기록 보관함 ─────────────────────────────────────────────────

/**
 * 보관함. **내 몫(view)만으로 만든다.**
 *
 * 남의 1:1 고백은 애초에 view에 없다. 여기서 거르는 것이 아니라
 * 서버가 담지 않은 것이다.
 */
export function LiveArchive({ gameId, onClose }: { gameId: string; onClose?: () => void }) {
  const state = useGame(gameId)
  const act = useMemo(() => gameActions(gameId), [gameId])
  const uid = uidNow()
  const [note, setNote] = useState<DeductionNote | null>(null)
  // 기록 본문. 열었을 때 보이려면 미리 받아 둬야 한다 —
  // 탭할 때마다 왕복하면 보관함이 느려진다
  const [papers, setPapers] = useState<Record<number, string[]>>({})

  useEffect(() => {
    let live = true
    act
      .releasedFragments()
      .then((r) => {
        if (!live) return
        const out: Record<number, string[]> = {}
        for (const f of (r as { fragments: DayFragment[] }).fragments) {
          out[f.day] = f.papers.flatMap((pp) => [...pp.lines, ...(pp.topLines ?? [])])
        }
        setPapers(out)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [act])

  useEffect(() => {
    if (!uid) return
    let live = true
    loadNote(gameId, uid).then((n) => live && setNote(n))
    return () => {
      live = false
    }
  }, [gameId, uid])

  const seats = state.game?.seats ?? []
  const nameOf = useCallback(
    (id: string) => seats.find((s) => s.playerId === id)?.name ?? id,
    [seats],
  )

  const items: ArchiveItem[] = useMemo(() => {
    const v = state.view
    if (!v || !uid) return []
    const read = new Set(v.readDays ?? [])
    return buildArchive({
      viewerId: uid,
      viewerTeam: (seats.find((s) => s.playerId === uid)?.team ?? 'A') as TeamId,
      records: (v.handledDays ?? []).map((day) => ({ day, atMs: day })),
      // 건너뛴 날이 「읽지 않음」이다 — 처리했지만 끝까지 보지 않은 날
      unreadDays: (v.handledDays ?? []).filter((d) => !read.has(d)),
      confessions: v.confessions ?? [],
      memories: v.memories ?? [],
      sights: v.sightAtMs ? [{ ownerId: uid, atMs: v.sightAtMs }] : [],
      over: state.game?.phase === 'finished',
      tileName: (id) => TILE_BY_ID[id]?.name ?? id,
      nameOf,
    })
  }, [state.view, state.game?.phase, uid, seats, nameOf])

  const change = useCallback(
    (next: DeductionNote) => {
      setNote(next)
      if (uid) void saveNote(gameId, next)
    },
    [gameId, uid],
  )

  if (!uid) return <Problem text="로그인이 필요하다." />
  if (state.error) return <Problem text={state.error} />
  if (!note) return null

  return (
    <Archive
      items={items}
      note={note}
      classmates={seats.filter((s) => s.playerId !== uid).map((s) => ({ id: s.playerId, name: s.name }))}
      // 본문은 서버가 준 것만 있다. 없는 항목은 빈 줄로 둔다
      bodyOf={(item) => bodyOf(state.view, papers, item)}
      onNoteChange={change}
      onClose={onClose}
    />
  )
}

/** 항목 본문. 서버가 준 것만 꺼낸다 — 지어내지 않는다. */
function bodyOf(
  view: ReturnType<typeof useGame>['view'],
  papers: Record<number, string[]>,
  item: ArchiveItem,
): string[] {
  if (item.tab === 'record' && item.day !== undefined) return papers[item.day] ?? []
  if (!view) return []
  if (item.tab === 'confession') {
    const id = item.id.replace('confession:', '')
    const c = (view.confessions ?? []).find((x) => x.id === id)
    return c ? [c.text] : []
  }
  // A의 기억 본문은 끝난 뒤 엔딩이 함께 내려보낸다
  return []
}

// ── 엔딩 ────────────────────────────────────────────────────────

/** 종례가 끝난 뒤에만 열린다. 그 전에는 서버가 거절한다. */
export function LiveEnding({ gameId }: { gameId: string }) {
  const act = useMemo(() => gameActions(gameId), [gameId])
  const [data, setData] = useState<EndingData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    act
      .ending()
      .then((d) => live && setData(d as EndingData))
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [act])

  if (error) return <Problem text={error} />
  if (!data) return null
  return <EndingSequence data={data} />
}

// ── 회고 ────────────────────────────────────────────────────────

/**
 * 역할을 내려놓고 이야기하는 자리.
 *
 * 게시판은 규칙이 직접 열어 준다 — 역할을 내려놓은 사람만 쓸 수 있고,
 * 익명 글에는 authorId가 **아예 담기지 않는다.**
 */
export function LiveRetro({ gameId }: { gameId: string }) {
  const state = useGame(gameId)
  const uid = uidNow()
  const [posts, setPosts] = useState<RetroPost[]>([])
  const [retired, setRetired] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!db || !uid) return
    const base = collection(db, 'games', gameId, 'retro')
    const stopPosts = onSnapshot(
      base,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RetroPost, 'id'>) }))
        setPosts(rows.sort((a, b) => a.atMs - b.atMs))
      },
      (e) => setError(e.message),
    )
    const stopMe = onSnapshot(doc(db, 'games', gameId, 'retired', uid), (snap) => setRetired(snap.exists()))
    return () => {
      stopPosts()
      stopMe()
    }
  }, [gameId, uid])

  const seats = state.game?.seats ?? []
  const me = seats.find((s) => s.playerId === uid)

  const retire = useCallback(async () => {
    if (!db || !uid) return
    await setDoc(doc(db, 'games', gameId, 'retired', uid), { playerId: uid, atMs: Date.now() }).catch((e) =>
      setError((e as Error).message),
    )
  }, [gameId, uid])

  const post = useCallback(
    async (text: string, anonymous: boolean) => {
      if (!db || !uid) return
      // newPost가 익명이면 authorId를 **아예 넣지 않는다.** 담아 두고
      // 화면에서 이름만 가리면 문서를 직접 읽는 순간 누군지 보인다
      const ref = doc(collection(db, 'games', gameId, 'retro'))
      const { id: _id, ...body } = newPost({ id: ref.id, authorId: uid, anonymous, text, atMs: Date.now() })
      await setDoc(ref, body).catch((e) => setError((e as Error).message))
    },
    [gameId, uid],
  )

  if (!uid) return <Problem text="로그인이 필요하다." />
  if (error) return <Problem text={error} />
  if (!me) return null

  return (
    <Retrospective
      viewerId={uid}
      look={normalizeLook({})}
      team={me.team}
      retired={retired}
      posts={posts}
      nameOf={(id) => seats.find((s) => s.playerId === id)?.name ?? id}
      onRetire={retire}
      onPost={post}
    />
  )
}

export type { TileId }
