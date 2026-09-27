// 씨앗으로 굴리는 주사위. **여기에는 아무것도 import 하지 않는다.**
//
// 전에는 이것이 역할 배정 파일(missions/assign) 안에 있었다. 화면이
// 리듬 악보를 만들려고 주사위를 가져오다가 그 파일이 끌고 오는 역할
// 문장까지 번들에 딸려 들어갔다 — 번들 검사가 잡았다. 주사위는 아무
// 비밀도 모르는 곳에 둔다.

/** 글자열 씨앗을 32비트로. */
export function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32. 짧고 재현되면 충분하다 — 암호에 쓰지 않는다. */
export function rngFrom(seed: string): () => number {
  let a = hashSeed(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
