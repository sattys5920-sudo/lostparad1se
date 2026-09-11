// 엔딩 검수용. 모든 문장이 가짜다 — 진짜는 서버에만 있다.
import { createRoot } from 'react-dom/client'
import { EndingSequence, type EndingData, type EndingPerson } from './EndingSequence'
import { normalizeLook } from '../char/look'
import type { TeamId } from '../../../shared/rules/v2'

const NAMES = ['한겨울', '서리', '눈보라', '고드름', '진눈깨비', '싸락', '함박', '가랑', '이슬', '서릿발', '새벽', '북풍', '동지', '소한']
const TEAMS: TeamId[] = ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'C', 'C', 'C', 'D', 'D', 'D']

const PEOPLE: EndingPerson[] = NAMES.map((name, i) => ({
  playerId: `p${i}`,
  name,
  team: TEAMS[i],
  look: normalizeLook({ hair: i % 30, hairColor: i % 9, expression: i % 6 }),
}))

const WHENS = ['학기 초', '가을', '겨울', '마지막 금요일', '17:10', '17:30', '18:00', '19:00', '21:00']

const DATA: EndingData = {
  hadInvisible: true,
  people: PEOPLE,
  teamResult: (['A', 'B', 'C', 'D'] as TeamId[]).map((team, i) => ({
    team,
    rank: i + 1,
    total: 70 - i * 9,
  })),
  personal: {
    band: '지나간 아이',
    lines: [
      '후회 줄 자리입니다. 검수용이라 내용은 아무 뜻이 없습니다.',
      '반성 줄 자리입니다.',
      '깨달음 줄 자리입니다.',
    ],
  },
  aftermath: NAMES.slice(0, 9).map((name, i) => ({
    when: WHENS[i],
    what: `전말 ${i + 1}번째 줄 자리입니다. 검수용 문장입니다.`,
    who: i === 5 ? [NAMES[5], NAMES[6]] : [name],
  })),
  aftermathClosing: '마지막 한 줄 자리입니다.',
  mirror: Array.from({ length: 8 }, (_, i) => ({
    rule: `규칙 ${i + 1}`,
    lived: `A가 겪은 일 ${i + 1} 자리입니다.`,
  })),
  unheard: [
    { name: '서리', day: 2, text: '지워진 날에 했던 말 자리입니다.' },
    { name: '북풍', day: 4, text: '또 다른 말 자리입니다.' },
  ],
  aWords: NAMES.slice(0, 4).map((name) => ({
    name,
    text: 'A의 시선 자리입니다. 검수용이라 내용은 아무 뜻이 없습니다.',
  })),
  torn: {
    intro: '소개 문구 자리입니다.',
    lines: ['찢긴 한 장 첫 줄 자리입니다.', '둘째 줄 자리입니다.', '셋째 줄.', '넷째 줄.'],
  },
  commonEnding: {
    title: '공동 엔딩 제목 자리',
    text: '공동 엔딩 본문 자리입니다. 검수용 문장입니다.',
    chalk: '칠판 글씨 자리',
  },
  myBoard: NAMES.slice(0, 13).map((name, i) => ({
    name,
    guess: i % 3 === 0 ? '도서부' : '모름',
    actual: ['도서부', '선봉', '수첩'][i % 3],
    correct: i % 3 === 0,
    firstDay: i % 3 === 0 ? (i % 5) + 1 : null,
  })),
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<EndingSequence data={DATA} />)
