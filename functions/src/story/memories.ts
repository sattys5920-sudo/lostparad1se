// A의 기억 열세 장면. **서버 전용.**
//
// 다툼이 벌어지는 칸에 한 장면씩 묻혀 있다. 어떤 팀이 그 칸을 처음
// 가져가면 그 팀 전원에게 열린다. 게임이 끝나면 열셋 모두 전원에게
// 공개된다.
//
// 출처: otherworld_setting.md 3장.
import type { TileId } from '../../../shared/rules/board'

export const MEMORIES: Record<TileId, string> = {
  library: '반납 도서 사이에 누가 꽂아 둔 쪽지. 「투명인간은 책도 안 읽지?」',
  gym: '짝 체조 시간. 선생님은 늘 "선생님이랑 하자"고 웃었다. 그 웃음이 제일 싫었다',
  cafeteria: '내 식판 옆자리에는 늘 가방이 먼저 앉아 있었다',
  rooftop: '옥상 문은 늘 잠겨 있었다. 그래서 그 앞 계단에 앉아 점심을 먹었다',
  oldBuilding: '구관 화장실 거울에 누가 립밤으로 적어 둔 글씨. 「없는 사람」',
  annex: '별관 계단은 아무도 안 다녀서 좋았다. 그래서 거기서 무슨 일이 있어도 아무도 몰랐다',
  newBuilding: '새 교실로 옮기던 날, 내 책상만 복도에 나와 있었다',
  mainBuilding: '현관 신발장. 내 실내화는 금요일마다 사라졌다가 월요일마다 쓰레기통에 있었다',
  playground: '체육대회 계주 명단. 내 이름 위에 누가 두 줄을 그어 놓았다',
  auditorium: '수련회 단체 사진. 내가 서 있던 자리만 잘려 있었다',
  broadcastRoom: '점심 방송 익명 신청곡. 「이번 주 투명인간에게 바칩니다」',
  studentCouncil: '건의함에 넣은 쪽지를 다음 날 쓰레기통에서 봤다. 접힌 모양 그대로였다',
  centralPlaza:
    '눈이 오면 발자국이 남잖아. 그래서 좋았어. 누가 봐도 내가 여기 있었다는 걸 알 수 있으니까',
}

export const MEMORY_TILE_IDS: readonly TileId[] = Object.keys(MEMORIES)
