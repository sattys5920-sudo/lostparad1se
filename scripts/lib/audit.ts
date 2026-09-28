// 화면에 실제로 그려진 글자를 훑는다. 캡처 스크립트들이 같이 쓴다.
//
//   ㆍ 픽셀 글꼴(Galmuri11)인데 11 · 22 · 33 · 44 가 아닌 글자 — 획이 번진다
//   ㆍ 본문 글꼴인데 20 · 16 · 13 · 11 이 아닌 글자 — 눈금 밖이다
//   ㆍ 배경과의 대비가 4.5:1 이 안 되는 글자(18px 이상은 3:1)
//
// CSS 파일을 읽는 것이 아니라 **그려진 결과**를 본다. 어느 규칙이 이겼는지는
// 브라우저만 안다.
import type { Page } from 'playwright'

export interface AuditHit {
  kind: 'pixel' | 'scale' | 'contrast' | 'input' | 'tap'
  where: string
  what: string
}

export async function auditText(page: Page): Promise<AuditHit[]> {
  return page.evaluate(() => {
    const out: { kind: 'pixel' | 'scale' | 'contrast' | 'input' | 'tap'; where: string; what: string }[] = []
    const seen = new Set<string>()
    const parse = (c: string): [number, number, number, number] | null => {
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
      return [p[0], p[1], p[2], p[3] ?? 1]
    }
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    /** 뒤에 칠해진 색. 반투명은 아래 것과 섞는다 */
    const backOf = (el: Element | null): number[] => {
      const stack: number[][] = []
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor)
        if (c && c[3] > 0) {
          stack.push(c)
          if (c[3] >= 1) break
        }
        // 이미지·그라데이션 바탕, 캔버스로 그린 종이는 모른다 — 거기서 멈춘다
        if (getComputedStyle(e).backgroundImage !== 'none') return []
        if (e.querySelector(':scope > canvas, :scope > svg')) return []
      }
      let col = [13, 15, 22]
      for (const c of stack.reverse()) col = [0, 1, 2].map((i) => c[i] * c[3] + col[i] * (1 - c[3]))
      return col
    }
    const name = (el: Element) => {
      const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)[0]
      return cls ? `.${cls}` : el.tagName.toLowerCase()
    }
    // 16 아래인 입력칸 — 아이폰이 확대한다
    for (const el of Array.from(document.querySelectorAll('input, textarea, select'))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const t = (el as HTMLInputElement).type
      if (t === 'checkbox' || t === 'radio' || t === 'range') continue
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size < 16) out.push({ kind: 'input', where: name(el), what: `${size}px` })
    }
    // 44 보다 작은 누를 것. ::after 로 넓힌 히트박스도 센다
    for (const el of Array.from(document.querySelectorAll('button, a[href], [role="button"], select, input[type="checkbox"], input[type="radio"]'))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue
      if (getComputedStyle(el).visibility === 'hidden') continue
      const af = getComputedStyle(el, '::after')
      const bf = getComputedStyle(el, '::before')
      const reach = (p: CSSStyleDeclaration) =>
        p.content !== 'none' && p.position === 'absolute' ? [parseFloat(p.width) || 0, parseFloat(p.height) || 0] : [0, 0]
      const [aw, ah] = reach(af)
      const [bw, bh] = reach(bf)
      const w = Math.max(r.width, aw, bw)
      const h = Math.max(r.height, ah, bh)
      if ((w < 43.5 || h < 43.5) && !seen.has(`t|${name(el)}`)) {
        seen.add(`t|${name(el)}`)
        out.push({ kind: 'tap', where: name(el), what: `${Math.round(w)}×${Math.round(h)} 「${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 10)}」` })
      }
    }
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')
      const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
      if (!own && !isInput) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden') continue
      let op = 1
      for (let e: Element | null = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity)
      if (op < 0.05) continue
      const size = parseFloat(cs.fontSize)
      const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim()
      const where = name(el)
      const text = (el.textContent ?? '').trim().slice(0, 12)
      const key = (k: string) => `${k}|${where}|${size}`
      if (fam.startsWith('Galmuri')) {
        if (![11, 22, 33, 44].includes(size) && !seen.has(key('p'))) {
          seen.add(key('p'))
          out.push({ kind: 'pixel', where, what: `${size}px 「${text}」` })
        }
      } else if (![11, 13, 16, 20].includes(size) && !seen.has(key('s'))) {
        seen.add(key('s'))
        out.push({ kind: 'scale', where, what: `${fam} ${size}px 「${text}」` })
      }
      const fg = parse(cs.color)
      const bg = backOf(el)
      if (!fg || bg.length === 0 || isInput) continue
      const mixed = [0, 1, 2].map((i) => fg[i] * fg[3] * op + bg[i] * (1 - fg[3] * op))
      const a = lum(mixed)
      const b = lum(bg)
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      const need = size >= 18 ? 3 : 4.5
      if (ratio < need && !seen.has(key('c'))) {
        seen.add(key('c'))
        out.push({ kind: 'contrast', where, what: `${ratio.toFixed(1)}:1 「${text}」` })
      }
    }
    return out
  })
}
