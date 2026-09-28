// 보낸 말을 서버보다 먼저 로그에 세운다 — 말줄과 무전이 같이 쓴다.
//
// 전에는 보내기를 누르면 서버가 대답할 때까지 아무 일도 없었다. 그동안
// 단추는 잠겨 있었고, 대답이 와야 칸이 비었다. 폰에서는 그 반 초가
// 「안 눌렸나?」로 읽혀서 한 번 더 누르게 되고, 그 사이 칸이 초점을
// 잃으면 키보드가 내려갔다가 다시 올라왔다.
//
// 지금은 누르는 순간 줄이 선다. 칸은 곧바로 비고 계속 칠 수 있다.
// 서버 줄이 오면 **그 줄이 이 줄을 대신한다** — 두 번 보이면 안 된다.
// 실패하면 줄이 붉게 남고, 누르면 다시 간다.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent as KeyEv, MouseEvent as MouseEv, PointerEvent as PtrEv } from 'react'

export interface Outgoing {
  id: number
  text: string
  /** 날아가는 중 · 서버가 받았다(아직 목록에 안 왔다) · 실패 */
  state: 'sending' | 'sent' | 'failed'
  /**
   * 보낼 때 목록의 맨 끝 줄. **이 뒤에 온 줄만 짝이 될 수 있다** —
   * 아까 한 같은 말(「ㅇㅇ」)을 이번 말의 서버 줄로 잘못 집으면 안 된다.
   */
  after: unknown
  /** 보낸 자리. 방을 옮기면 옛 방에서 한 말은 새 방 로그에 안 선다 */
  scope: string | null
}

/**
 * 서버 줄과 짝이 맞은 보낸 말들의 id.
 *
 * 앞에서부터 하나씩 짝을 짓고, 한 번 짝이 된 서버 줄은 다시 안 쓴다 —
 * 「ㅋㅋ」를 두 번 보냈는데 서버 줄이 하나만 왔으면 하나만 지운다.
 * 목록은 뒤에 붙기만 하므로(방 말은 앞이 잘리기도 한다) 끝 줄을 못
 * 찾으면 처음부터 본다 — 그만큼 새 줄이 왔다는 뜻이다.
 */
export function settled<L>(
  lines: readonly L[],
  out: readonly Outgoing[],
  mine: (l: L, text: string) => boolean,
): Set<number> {
  const done = new Set<number>()
  const used = new Set<L>()
  for (const o of out) {
    if (o.state === 'failed') continue
    const from = o.after === null ? 0 : lines.indexOf(o.after as L) + 1
    for (let i = from; i < lines.length; i += 1) {
      const l = lines[i]
      if (used.has(l) || !mine(l, o.text)) continue
      used.add(l)
      done.add(o.id)
      break
    }
  }
  return done
}

export interface Outbox {
  /** 아직 서버 줄이 안 온 보낸 말. 로그 끝에 이어 그린다 */
  waiting: readonly Outgoing[]
  /**
   * 보낸다. **같은 말이 아직 날아가는 중이면 false** — 도배 막이는 이것
   * 하나뿐이다. 단추도 칸도 잠그지 않는다.
   */
  submit: (text: string) => boolean
  /** 실패한 줄을 다시 보낸다 */
  retry: (id: number) => void
}

export function useOutbox<L>(opts: {
  lines: readonly L[]
  /** 이 서버 줄이 내가 보낸 이 말인가 */
  mine: (l: L, text: string) => boolean
  /** 서버에 보낸다. 실패하면 던진다 — 붉은 줄이 된다 */
  post: (text: string) => Promise<void>
  scope?: string | null
}): Outbox {
  const { lines, mine, post } = opts
  const scope = opts.scope ?? null
  const [out, setOut] = useState<Outgoing[]>([])
  const idRef = useRef(0)
  /** 날아가는 중인 말과 그 수. 같은 말이 잇달아 겹쳐 가는 것만 막는다 */
  const flying = useRef(new Map<string, number>())
  /** 바로 앞에 보낸 말. 「잇달아」를 가르는 데 쓴다 */
  const lastRef = useRef<string | null>(null)
  // 보내는 순간의 끝 줄과 자리를 읽어야 한다. 렌더 밖(누르는 손)에서 읽으므로 ref 로 든다
  const now = useRef({ lines, scope, post })
  useLayoutEffect(() => {
    now.current = { lines, scope, post }
  }, [lines, scope, post])

  const done = useMemo(() => settled(lines, out, mine), [lines, out, mine])

  const fly = useCallback((o: Outgoing) => {
    const f = flying.current
    f.set(o.text, (f.get(o.text) ?? 0) + 1)
    lastRef.current = o.text
    now.current
      .post(o.text)
      .then(
        () => setOut((xs) => xs.map((x) => (x.id === o.id ? { ...x, state: 'sent' } : x))),
        () => setOut((xs) => xs.map((x) => (x.id === o.id ? { ...x, state: 'failed' } : x))),
      )
      .finally(() => {
        const n = (f.get(o.text) ?? 1) - 1
        if (n > 0) f.set(o.text, n)
        else f.delete(o.text)
      })
  }, [])

  const submit = useCallback(
    (text: string) => {
      // 방금 보낸 것과 같은 말이 아직 날아가는 중이면 한 번 더 누른 손이다
      if (lastRef.current === text && flying.current.has(text)) return false
      const { lines: ls, scope: sc } = now.current
      idRef.current += 1
      const o: Outgoing = { id: idRef.current, text, state: 'sending', after: ls[ls.length - 1] ?? null, scope: sc }
      // 짝이 맞은 것과 옛 자리의 것은 새로 보낼 때 치운다. 그리기는 이미 빼고 있다
      setOut((xs) => {
        const gone = settled(ls, xs, mine)
        return [...xs.filter((x) => !gone.has(x.id) && x.scope === sc), o]
      })
      fly(o)
      return true
    },
    [fly, mine],
  )

  const retry = useCallback(
    (id: number) => {
      const o = out.find((x) => x.id === id)
      if (!o || o.state !== 'failed' || flying.current.has(o.text)) return
      const ls = now.current.lines
      // 다시 보낸 말의 짝은 **지금부터** 온 줄에서 찾는다
      const again: Outgoing = { ...o, state: 'sending', after: ls[ls.length - 1] ?? null }
      setOut((xs) => xs.map((x) => (x.id === id ? again : x)))
      fly(again)
    },
    [out, fly],
  )

  const waiting = useMemo(() => out.filter((o) => !done.has(o.id) && o.scope === scope), [out, done, scope])
  return { waiting, submit, retry }
}

/**
 * 입력칸 한 줄과 보내기 단추 — 말줄과 무전이 **같은 손**을 쓴다.
 *
 * 1. **칸을 떼지 않는다.** 보내고 나면 값만 비운다. key 를 바꾸거나 칸을
 *    새로 그리면 초점이 날아가고, 폰에서는 그게 곧 키보드가 내려가는 일이다.
 * 2. **단추는 누르는 순간(pointerdown) 보낸다.** 손을 뗄 때(click)까지
 *    기다리면 그 사이에 칸이 초점을 잃는다 — 키보드가 내려가며 단추가
 *    같이 내려가고, 손을 뗀 자리에는 이미 단추가 없다. 로그인과 무전에서
 *    같은 자리로 두 번 막혔다. preventDefault 로 초점을 칸에 붙들어 둔다.
 * 3. **한글 조합 중에는 엔터로 안 보낸다.** 조합을 끝내는 엔터가 한 번 더
 *    오는 브라우저가 있어서, 안 막으면 같은 말이 두 번 가거나 마지막
 *    글자만 따로 한 줄 간다.
 * 4. **조합 중에 비운 칸에 마지막 글자가 되살아난다.** 아이폰은 「안녕」의
 *    「녕」을 조합하는 도중에 단추를 누르면, 칸을 비운 뒤에 조합을 마저
 *    끝내며 「녕」을 도로 적어 넣는다. 보낸 바로 다음 한 번만 그 글자를 버린다.
 */
export function useSendBox(opts: {
  /** 보낸다. 칸을 비워도 되면 true — 못 보냈으면 적은 글을 그대로 둔다 */
  send: (text: string) => boolean
  max: number
}) {
  const { send, max } = opts
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const composing = useRef(false)
  /** 조합 중에 보낸 말의 마지막 글자. 되살아나면 한 번 버린다 */
  const ghost = useRef<string | null>(null)

  function fire() {
    if (!send(draft.trim())) return
    if (composing.current) ghost.current = draft.trim().slice(-1)
    setDraft('')
  }

  const box = {
    ref: inputRef,
    value: draft,
    maxLength: max,
    enterKeyHint: 'send' as const,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      let v = e.target.value.slice(0, max)
      const g = ghost.current
      ghost.current = null
      if (g !== null && v === g) v = ''
      setDraft(v)
    },
    onCompositionStart: () => {
      composing.current = true
    },
    onCompositionEnd: () => {
      composing.current = false
    },
    onKeyDown: (e: KeyEv<HTMLInputElement>) => {
      if (e.key !== 'Enter') return
      // 229 는 사파리가 조합 중인 키에 붙이는 번호다. isComposing 이 false 로 와도 조합 중이다
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      e.preventDefault()
      fire()
    },
  }

  const button = {
    type: 'button' as const,
    onPointerDown: (e: PtrEv<HTMLButtonElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      fire()
    },
    // pointerdown 을 막아도 mousedown 으로 초점을 옮기는 브라우저가 있다
    onMouseDown: (e: MouseEv<HTMLButtonElement>) => e.preventDefault(),
    onClick: (e: MouseEv<HTMLButtonElement>) => {
      // 키보드(엔터·스페이스)로 누른 단추에는 pointerdown 이 없다
      if (e.detail === 0) {
        fire()
        return
      }
      // 칸이 닫혀 있었으면 연다. 아이폰은 손을 뗄 때(click) 준 초점에만 키보드를 연다
      if (document.activeElement !== inputRef.current) inputRef.current?.focus()
    },
  }

  return { draft, box, button, inputRef }
}
