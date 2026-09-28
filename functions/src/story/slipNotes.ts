// 쪽지 56장. **서버 전용.** 번들 누출 검사가 이 파일의 문장을 본다.
//
// 기준은 docs/notes_56_linked.md 다. 문안은 문서 원문 그대로이고, 문서와
// 같은지는 `npm run check:notes`(빌드 때도 돈다)가 본다. 고칠 때는 문서를
// 고치고 여기도 똑같이 고친다.
//
// 역할마다 네 장, 두 장씩 짝이다. 짝의 두 장은 같은 행동을 말한다.
//
//   role   역할 이름 + 행동. 누구인지는 안 나온다
//   name   {이름} + 행동. 무슨 역할인지는 안 나온다
//
// {이름}은 **읽는 순간** 서버가 그 역할을 받은 사람의 이름으로 바꿔
// 보낸다(views). 화면에는 바뀐 문장만 간다 — 원문 틀과 roleKey 는 어떤
// 응답에도 안 실린다. roleKey 가 새면 이름형 한 장으로 역할이 드러난다.
import type { RoleId } from '../../../shared/missions/roleNames'

export type SlipNoteKind = 'role' | 'name'

export interface SlipNote {
  /** r01-p1-role — 역할 번호 · 짝 · 종류 */
  id: string
  /** 이 쪽지가 가리키는 역할. **쪽지의 주인은 이 역할을 받은 사람이다** */
  roleKey: RoleId
  kind: SlipNoteKind
  /** 1짝(습관) · 2짝(그날). 2짝은 세다 — DAY 3 이후에 뿌린다 */
  pair: 1 | 2
  /** 문안 원문. 이름형은 {이름}을 그대로 둔다 */
  text: string
}

export const SLIP_NOTES: readonly SlipNote[] = [
  // 01 반장
  { id: 'r01-p1-role', roleKey: 'classlead', kind: 'role', pair: 1, text: "금요일마다 접힌 종이를 걷어 세는 건 늘 반장이었다. 세고 나면 아무 말도 하지 않았다." },
  { id: 'r01-p1-name', roleKey: 'classlead', kind: 'name', pair: 1, text: "{이름}은 쉬는 시간마다 반을 한 바퀴 돈다. 누가 없는지 세는 사람은 그 애뿐이다." },
  { id: 'r01-p2-role', roleKey: 'classlead', kind: 'role', pair: 2, text: "그날 저녁 학교에 남은 사람 명단을 적은 건 반장이다. 그 종이에 A의 이름은 없었다." },
  { id: 'r01-p2-name', roleKey: 'classlead', kind: 'name', pair: 2, text: "{이름}은 A가 남아 있는 걸 알고 있었다. 알고도 명단에서 뺐다." },
  // 02 모범생
  { id: 'r02-p1-role', roleKey: 'model', kind: 'role', pair: 1, text: "어른들은 무슨 일이 생기면 모범생에게 먼저 묻는다. 그리고 확인하지 않는다." },
  { id: 'r02-p1-name', roleKey: 'model', kind: 'name', pair: 1, text: "{이름}의 말이라면 선생님들은 되묻지 않는다." },
  { id: 'r02-p2-role', roleKey: 'model', kind: 'role', pair: 2, text: "다음 날 아침, 어젯밤에 아무 일도 없었다고 답한 건 모범생이다." },
  { id: 'r02-p2-name', roleKey: 'model', kind: 'name', pair: 2, text: "{이름}은 그때 이미 창고 쪽 이야기를 들은 뒤였다." },
  // 03 매점 단골
  { id: 'r03-p1-role', roleKey: 'snacker', kind: 'role', pair: 1, text: "매점 단골의 주머니에는 금요일마다 자기 것이 아닌 돈이 있었다." },
  { id: 'r03-p1-name', roleKey: 'snacker', kind: 'name', pair: 1, text: "{이름}은 늘 뭔가를 사 먹고, 늘 뭔가를 바꿔 온다." },
  { id: 'r03-p2-role', roleKey: 'snacker', kind: 'role', pair: 2, text: "그날도 A는 급식비를 매점 단골에게 건넸다. 그게 마지막이었다." },
  { id: 'r03-p2-name', roleKey: 'snacker', kind: 'name', pair: 2, text: "A가 더는 못 주겠다고 한 날, {이름}은 A의 이야기를 반에 흘렸다." },
  // 04 파수꾼
  { id: 'r04-p1-role', roleKey: 'locker', kind: 'role', pair: 1, text: "교실에서 없어진 물건이 어디 있는지 아는 건 파수꾼뿐이다." },
  { id: 'r04-p1-name', roleKey: 'locker', kind: 'name', pair: 1, text: "{이름}의 사물함은 늘 잠겨 있고, 늘 꽉 차 있다." },
  { id: 'r04-p2-role', roleKey: 'locker', kind: 'role', pair: 2, text: "금요일에 A의 실내화를 가져간 건 파수꾼이다." },
  { id: 'r04-p2-name', roleKey: 'locker', kind: 'name', pair: 2, text: "이름표가 지워진 실내화 한 짝이 아직 {이름}에게 있다." },
  // 05 도서부
  { id: 'r05-p1-role', roleKey: 'bookclub', kind: 'role', pair: 1, text: "반을 돌던 쪽지의 출처를 따라가면 늘 도서부의 손이 나온다." },
  { id: 'r05-p1-name', roleKey: 'bookclub', kind: 'name', pair: 1, text: "{이름}은 남이 흘린 종이를 그냥 지나치지 못한다." },
  { id: 'r05-p2-role', roleKey: 'bookclub', kind: 'role', pair: 2, text: "A의 이야기가 단톡방에 올라오기 전, 그 종이는 도서부에게 있었다." },
  { id: 'r05-p2-name', roleKey: 'bookclub', kind: 'name', pair: 2, text: "{이름}은 그걸 읽고, 읽은 채로 다른 사람에게 넘겼다." },
  // 06 미화부
  { id: 'r06-p1-role', roleKey: 'cleanup', kind: 'role', pair: 1, text: "교실에서 뭔가 사라지면 대체로 미화부가 치운 것이다. 버린 게 아니라 없앤 것이다." },
  { id: 'r06-p1-name', roleKey: 'cleanup', kind: 'name', pair: 1, text: "{이름}은 책상 위에 종이 한 장 남는 걸 못 견딘다." },
  { id: 'r06-p2-role', roleKey: 'cleanup', kind: 'role', pair: 2, text: "다음 날 아침 창고 앞에 떨어져 있던 종이를 주운 건 미화부다." },
  { id: 'r06-p2-name', roleKey: 'cleanup', kind: 'name', pair: 2, text: "{이름}은 그 종이를 읽지 않고 찢었다. 읽으면 못 찢을 것 같아서." },
  // 07 주번
  { id: 'r07-p1-role', roleKey: 'duty', kind: 'role', pair: 1, text: "그 주 문단속 당번은 주번이었다." },
  { id: 'r07-p1-name', roleKey: 'duty', kind: 'name', pair: 1, text: "{이름}은 늘 마지막으로 학교를 나선다." },
  { id: 'r07-p2-role', roleKey: 'duty', kind: 'role', pair: 2, text: "창고 안에서 소리가 났지만, 주번은 고양이겠거니 하고 자물쇠를 채웠다." },
  { id: 'r07-p2-name', roleKey: 'duty', kind: 'name', pair: 2, text: "다음 날 아침 그 자물쇠를 연 것도 {이름}이었다." },
  // 08 원예부
  { id: 'r08-p1-role', roleKey: 'gardener', kind: 'role', pair: 1, text: "정원 화분 흙을 들추면 가끔 심은 적 없는 것이 나온다. 그 화분을 돌보는 건 원예부다." },
  { id: 'r08-p1-name', roleKey: 'gardener', kind: 'name', pair: 1, text: "{이름}은 누가 화분을 건드리면 바로 안다." },
  { id: 'r08-p2-role', roleKey: 'gardener', kind: 'role', pair: 2, text: "그날 밤 정원에서 아무것도 심지 않고 흙만 판 건 원예부다." },
  { id: 'r08-p2-name', roleKey: 'gardener', kind: 'name', pair: 2, text: "A의 휴대폰은 그때부터 울리지 않았다. {이름}이 묻었기 때문이다." },
  // 09 과학부
  { id: 'r09-p1-role', roleKey: 'science', kind: 'role', pair: 1, text: "과학부는 헌 교복으로 사람 모양을 만든다. 멀리서 보면 사람 같다." },
  { id: 'r09-p1-name', roleKey: 'science', kind: 'name', pair: 1, text: "방과 후 과학실 불은 {이름} 때문에 꺼지지 않는다." },
  { id: 'r09-p2-role', roleKey: 'science', kind: 'role', pair: 2, text: "그날 저녁 창고 전등을 내려 둔 건 과학부다. 고장이 아니었다." },
  { id: 'r09-p2-name', roleKey: 'science', kind: 'name', pair: 2, text: "며칠 뒤 창고 앞에 사람 모양이 하나 서 있었다. {이름}이 만든 것이었다." },
  // 10 기술부
  { id: 'r10-p1-role', roleKey: 'tech', kind: 'role', pair: 1, text: "기술부는 열쇠 없이도 열고, 열쇠가 있어도 부순다." },
  { id: 'r10-p1-name', roleKey: 'tech', kind: 'name', pair: 1, text: "{이름}은 조립보다 분해가 빠르다." },
  { id: 'r10-p2-role', roleKey: 'tech', kind: 'role', pair: 2, text: "그 주에 창고 문고리를 손본 건 기술부다. 안에서는 열리지 않게 되었다." },
  { id: 'r10-p2-name', roleKey: 'tech', kind: 'name', pair: 2, text: "{이름}은 그렇게 되는 걸 알고 있었다. 알고서 그렇게 고쳤다." },
  // 11 전교 1등
  { id: 'r11-p1-role', roleKey: 'topstudent', kind: 'role', pair: 1, text: "반에서 전교 1등보다 앞선 적이 있는 사람은 A뿐이었다." },
  { id: 'r11-p1-name', roleKey: 'topstudent', kind: 'name', pair: 1, text: "{이름}은 시험지를 받으면 손이 먼저 움직인다." },
  { id: 'r11-p2-role', roleKey: 'topstudent', kind: 'role', pair: 2, text: "마지막 시험 뒤 A의 답안지가 사라졌다. 그날 교무실에 마지막으로 들어간 건 전교 1등이다." },
  { id: 'r11-p2-name', roleKey: 'topstudent', kind: 'name', pair: 2, text: "{이름}은 A가 대신 풀어 준 답안으로 1등을 했다. A는 끝까지 말하지 않았다." },
  // 12 짝사랑
  { id: 'r12-p1-role', roleKey: 'crush', kind: 'role', pair: 1, text: "가방에 부치지 못한 편지를 넣고 다니는 건 짝사랑이다." },
  { id: 'r12-p1-name', roleKey: 'crush', kind: 'name', pair: 1, text: "{이름}은 하루에 몇 번씩 같은 방향을 본다." },
  { id: 'r12-p2-role', roleKey: 'crush', kind: 'role', pair: 2, text: "다섯 시에 창고 앞에서 기다리겠다는 편지를 쓴 건 짝사랑이다." },
  { id: 'r12-p2-name', roleKey: 'crush', kind: 'name', pair: 2, text: "{이름}은 끝내 그 자리에 가지 않았다. A는 거기서 기다렸다." },
  // 13 전학생
  { id: 'r13-p1-role', roleKey: 'newcomer', kind: 'role', pair: 1, text: "전학생은 전에 다니던 학교 이야기를 절대 하지 않는다." },
  { id: 'r13-p1-name', roleKey: 'newcomer', kind: 'name', pair: 1, text: "{이름}은 이번 학기에 전학 왔다. 반에 녹아드는 게 이상하리만치 빨랐다." },
  { id: 'r13-p2-role', roleKey: 'newcomer', kind: 'role', pair: 2, text: "전 학교에서 A를 괴롭히던 무리에 전학생도 있었다." },
  { id: 'r13-p2-name', roleKey: 'newcomer', kind: 'name', pair: 2, text: "A가 알아본 다음 날, A의 옛날 이야기를 먼저 꺼낸 건 {이름}이다." },
  // 14 뒷자리
  { id: 'r14-p1-role', roleKey: 'backseat', kind: 'role', pair: 1, text: "금요일이면 뒷자리 주위로 애들이 모였다가 흩어진다." },
  { id: 'r14-p1-name', roleKey: 'backseat', kind: 'name', pair: 1, text: "{이름}의 자리는 맨 뒷줄이다. 거기서는 교실 전체가 보인다." },
  { id: 'r14-p2-role', roleKey: 'backseat', kind: 'role', pair: 2, text: "누구 이름을 적을지는 투표 전에 이미 정해져 있었다. 정한 건 뒷자리다." },
  { id: 'r14-p2-name', roleKey: 'backseat', kind: 'name', pair: 2, text: "A가 몇 주째 뽑힌 건 우연이 아니었다. {이름}이 매주 같은 이름을 돌렸다." },
]

export const SLIP_NOTE_BY_ID: Readonly<Record<string, SlipNote>> = Object.fromEntries(SLIP_NOTES.map((n) => [n.id, n]))
