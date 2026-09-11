// 엔딩 장면 순서와 건너뛰기.
import { describe, expect, it } from 'vitest'
import { nextScene, playedScenes, prevScene, sceneIndex, SCENE_IDS, SCENES, skippedScenes } from './ending'

describe('열 장면', () => {
  it('문서 5장 표 순서 그대로다', () => {
    expect(SCENE_IDS).toEqual([
      'closing',
      'teamResult',
      'personal',
      'aftermath',
      'mirror',
      'unheard',
      'aWords',
      'tornPage',
      'commonEnding',
      'archive',
    ])
  })

  it('전말이 거울보다 먼저다', () => {
    // otherworld 8장은 거울을 먼저 두지만 scenario 5장이 덮는다
    expect(SCENE_IDS.indexOf('aftermath')).toBeLessThan(SCENE_IDS.indexOf('mirror'))
  })

  it('찢긴 한 장이 공동 엔딩 바로 앞이다', () => {
    expect(SCENE_IDS.indexOf('tornPage') + 1).toBe(SCENE_IDS.indexOf('commonEnding'))
  })

  it('모두 이름이 있다', () => {
    for (const s of SCENES) expect(s.title.length).toBeGreaterThan(0)
  })
})

describe('투명인간이 없었던 판', () => {
  it('들리지 않았던 말을 건너뛴다', () => {
    expect(skippedScenes({ hadInvisible: false })).toEqual(['unheard'])
    expect(playedScenes({ hadInvisible: false }).map((s) => s.id)).not.toContain('unheard')
  })

  it('있었으면 그대로 나온다', () => {
    expect(skippedScenes({ hadInvisible: true })).toEqual([])
    expect(playedScenes({ hadInvisible: true })).toHaveLength(10)
  })

  it('건너뛰면 앞뒤가 바로 이어진다', () => {
    const none = { hadInvisible: false }
    expect(nextScene('mirror', none)).toBe('aWords')
    expect(prevScene('aWords', none)).toBe('mirror')
  })

  it('있으면 사이에 낀다', () => {
    const had = { hadInvisible: true }
    expect(nextScene('mirror', had)).toBe('unheard')
    expect(nextScene('unheard', had)).toBe('aWords')
  })
})

describe('진행', () => {
  it('마지막 다음은 없다', () => {
    expect(nextScene('archive', { hadInvisible: true })).toBe(null)
  })

  it('처음 앞은 없다', () => {
    expect(prevScene('closing', { hadInvisible: true })).toBe(null)
  })

  it('몇 번째인지 센다', () => {
    expect(sceneIndex('closing', { hadInvisible: true })).toEqual({ at: 1, total: 10 })
    expect(sceneIndex('archive', { hadInvisible: false })).toEqual({ at: 9, total: 9 })
  })
})
