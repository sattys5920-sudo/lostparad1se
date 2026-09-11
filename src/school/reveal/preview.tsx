// 아침 시퀀스 검수용.
//
// 서버 없이 화면만 본다. 여기 적힌 본문은 **검수용 가짜**다 —
// 진짜 문장은 functions/src/story 에 있고 서버가 내려보낸다.
// 번들 누출 검사가 이 파일도 훑으므로, 진짜 문장을 여기 옮겨 적으면
// 그 순간 CI가 빨개진다.
import { createRoot } from 'react-dom/client'
import { MorningSequence, type DayFragment } from './MorningSequence'

const FAKE: DayFragment[] = [
  {
    day: 2,
    spotTile: 'scienceRoom',
    papers: [
      {
        kind: 'diary',
        lines: ['첫째 줄 자리입니다. 검수용 문장이라 내용은 아무 뜻이 없습니다.'],
        caption: null,
        topLines: null,
        topCaption: null,
      },
      {
        kind: 'note',
        lines: ['둘째 종이 자리입니다. 한 조각에 두 장이면 순서대로 넘어갑니다.'],
        caption: '(괄호 지문 자리 · 작은 회색 캡션)',
        topLines: null,
        topCaption: null,
      },
    ],
  },
  {
    day: 5,
    spotTile: 'hallway',
    papers: [
      {
        kind: 'note',
        lines: ['본문 자리입니다. 탭을 한 번 더 하면 맨 위가 나옵니다.', '두 번째 줄 자리입니다.'],
        caption: null,
        topLines: ['맨 위 줄 자리입니다. 다른 줄보다 또박또박한 글씨입니다.'],
        topCaption: '(같은 종이 맨 위 · 캡션 자리)',
      },
    ],
  },
]

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <MorningSequence
      fragments={FAKE}
      invisibleNameByDay={{ 2: '검수용 이름' }}
      snowLevel={4}
      onFinish={(r) => console.log('finished', r)}
    />,
  )
}
