// 역할 열넷 — **데이터 파일. 서버 전용.** (번들 누출 검사 대상)
//
// docs/roles_full.md 에서 뽑았다(scripts/gen-roles.ts). **문장은 문서와
// 한 글자도 다르지 않아야 한다** — 빌드 때 check-roles 가 본다.
//
// **수치를 고칠 때는 이 파일만 고친다.** need(이상) · limit(이하) ·
// minutes(분). 「세는 것」 말 안의 {분} 은 minutes 로 채워 보인다.
// 판정 코드(judge.ts)에는 숫자가 한 개도 없다.
//
//   key        역할 키. 판 안에서만 쓰고 어떤 응답에도 안 싣는다
//   intro      학생증 앞면 한 줄 소개
//   situation  학생증 뒷면 「그해 겨울, 나는」 문단들
//   goal       미션 요약(운영자 화면)
//   line       미션 한 줄(「이번에는 …」)
//   clauses    세는 것 · 기준 · 공개 시점
//   footnote   조건 표 아래 단서
//   notes      쪽지 넉 장. {이름}은 읽는 순간 서버가 그 역할을 받은 사람 이름으로
import type { RoleData } from './roleTypes'

export const ROLE_DATA: readonly RoleData[] = [
  {
    key: "classlead",
    no: 1,
    name: "반장",
    branch: "people",
    star: false,
    intro: "이름을 못 외우는 애가 없다.",
    situation: [
      "그날 저녁, 학교에 남은 사람 명단을 적어 교무실에 내는 게 반장 일이었다. 원래는 교실을 한 바퀴 돌면서 확인해야 한다. 하지만 눈이 와서 빨리 가고 싶었고, 교실 세 개만 들여다보고 남은 사람이 없다고 적었다. 그래서 그 밤, 학교에 사람이 남아 있다는 사실을 아무도 몰랐다.",
    ],
    goal: "5명 이상의 다른 사람과 같은 방에 1분 이상 함께 머문다.",
    line: "이번에는 한 바퀴 다 돈다.",
    clauses: [
      { kind: "sameRoomPeople", text: "같은 방에 {분}분 이상 겹친 서로 다른 사람", need: 5, minutes: 1, disclosure: "realtime" },
    ],
    footnote: null,
    notes: [
      { slot: 1, kind: "role", text: "저녁마다 남은 사람 명단을 적어 교무실에 내는 건 반장이다." },
      { slot: 2, kind: "name", text: "{이름}은 그 일을 한 번도 빠뜨린 적이 없다. 적는 것만큼은." },
      { slot: 3, kind: "role", text: "그날 명단에는 남은 사람이 없다고 적혀 있었다. 적은 건 반장이다." },
      { slot: 4, kind: "role", text: "반장은 그날 교실 세 개만 들여다봤다. 눈이 와서 빨리 가고 싶었다." },
    ],
  },
  {
    key: "model",
    no: 2,
    name: "모범생",
    branch: "people",
    star: false,
    intro: "이 애 말은 다들 믿는다.",
    situation: [
      "다음 날 아침, 선생님이 물었다. 학생들 사이에서 수상한 일이 벌어지고 있냐고. 투명인간 투표에 대해서 알고 있었지만, 괜히 일이 커지는 게 싫어서 잘 모르겠다고 답했다. 선생님은 더 묻지 않았다. 모범생이 모른다고 하면 대체로 없는 일이었으니까.",
    ],
    goal: "서로 다른 두 분단으로부터 신뢰표를 2장 이상 받는다.",
    line: "이번에도 믿음을 받는다. 그 믿음으로 무엇을 할지는 본인이 정한다.",
    clauses: [
      { kind: "trustReceived", text: "받은 신뢰표", need: 2, disclosure: "daily" },
      { kind: "trustTeams", text: "보낸 사람의 분단 수", need: 2, disclosure: "daily" },
    ],
    footnote: "보낸 사람은 보이지 않는다. 진행도가 바로 오르면 방금 누가 줬는지 역추적된다.",
    notes: [
      { slot: 1, kind: "role", text: "어른들은 무슨 일이 생기면 모범생에게 먼저 묻고, 확인은 하지 않는다." },
      { slot: 2, kind: "role", text: "모범생의 말이라면 되묻지 않는다." },
      { slot: 3, kind: "role", text: "학생들끼리 수상한 짓을 하고 있지 않냐는 물음에 모범생은 잘 모르겠다고 했다." },
      { slot: 4, kind: "name", text: "{이름}은 전날 투명인간 투표에 대해 모를 리 없었다." },
    ],
  },
  {
    key: "treasurer",
    no: 3,
    name: "총무",
    branch: "people",
    star: false,
    intro: "누가 얼마를 냈는지는 다 알고 있다.",
    situation: [
      "반에서 걷는 돈은 전부 총무를 거친다. 단체 티셔츠, 사진값, 졸업 앨범. A가 투명인간이 되었기 때문에, 단체 티셔츠 비용을 A에게만 걷지 않았다. 없는 사람한테 돈을 걷는 게 이상해 보였고 말을 거는 것도 애매했다. 투명인간이 끝나면 물어봐야지 했지만, 까먹은 바람에 주문서를 제출했다. 그래서 A의 티셔츠는 없었다.",
    ],
    goal: "자판기에서 아이템을 2번 이상 산다. 그리고 다른 분단 사람과 거래를 1번 이상 성립시킨다.",
    line: "이번에는 돈이 돌게 한다.",
    clauses: [
      { kind: "vendBuys", text: "자판기 구매", need: 2, disclosure: "realtime" },
      { kind: "dealsWithOtherTeam", text: "다른 분단과 성립한 거래", need: 1, disclosure: "realtime" },
    ],
    footnote: "자판기 매입(파는 것)은 안 센다. 거래는 한쪽만 물건을 올려도 성립이다.",
    notes: [
      { slot: 1, kind: "role", text: "반에서 걷는 돈은 전부 총무의 손을 거친다." },
      { slot: 2, kind: "role", text: "총무는 누가 얼마를 냈는지 다 외운다." },
      { slot: 3, kind: "role", text: "그 학기 단체 티셔츠 주문서에 A의 몫은 없었다." },
      { slot: 4, kind: "name", text: "{이름}은 없는 사람에게 받는 게 이상하다고 생각했다." },
    ],
  },
  {
    key: "deskmate",
    no: 4,
    name: "짝꿍",
    branch: "slip",
    star: false,
    intro: "A와 제일 가까이 앉아 있었다.",
    situation: [
      "A의 짝꿍이었다. 투명인간 기간에도 자리는 그대로여서 매일 A 옆에 앉았다. 솔직히 말하면, A에게 말을 걸면 자기도 다음 주에 적힐 것 같았다. 그래서 필요한 말만 했다. 지우개 좀, 몇 페이지야, 그 정도. 그 오후, A가 편지를 보여 주면서 웃었다. 못 본 척하고 대답을 하지 않았다. 누구에게 받은 편지인지도 묻지 않았다. 그게 A가 누군가에게 마지막으로 말을 건 순간이었다.",
    ],
    goal: "쪽지 2장을 읽는다.",
    line: "이번에는 남의 사정을 끝까지 읽는다.",
    clauses: [
      { kind: "slipsRead", text: "읽은 쪽지", need: 2, disclosure: "realtime" },
    ],
    footnote: "같은 쪽지를 다시 읽어도 한 장이다.",
    notes: [
      { slot: 1, kind: "role", text: "투명인간이 되어도 자리는 그대로다. 짝꿍은 매일 A 옆에 앉았다." },
      { slot: 2, kind: "role", text: "짝꿍은 필요한 말만 했다. 지우개 좀, 몇 페이지야, 그 정도." },
      { slot: 3, kind: "name", text: "A는 {이름}에게 편지를 보여 주면서 웃었다고 한다." },
      { slot: 4, kind: "role", text: "짝꿍은 못 본 척했다. 대답하면 다음 주에 자기가 될 것 같아서." },
    ],
  },
  {
    key: "bookclub",
    no: 5,
    name: "도서부",
    branch: "slip",
    star: false,
    intro: "읽고, 분류하고, 넘긴다.",
    situation: [
      "A가 혼자 적어 둔 일기 한 장이 반 전부를 돌았다. 어디서 시작됐는지는 아무도 몰랐다. 도서부 손에 들어왔을 때 그 종이는 이미 여러 명을 거친 뒤였다. 버릴 수도 있었고 A에게 돌려줄 수도 있었다. 도서부는 그냥 읽고, 접어서, 다음 사람에게 넘겼다. 자기가 시작한 것도 아니니까.",
    ],
    goal: "쪽지 3장을 읽고, 그중 2장을 다른 사람에게 건넨다.",
    line: "이번에도 넘긴다. 다만 이번에는 누구에게 넘길지 고를 수 있다.",
    clauses: [
      { kind: "slipsRead", text: "읽은 쪽지", need: 3, disclosure: "realtime" },
      { kind: "slipsGiven", text: "남에게 건넨 쪽지", need: 2, disclosure: "realtime" },
    ],
    footnote: "직접 건넨 것과 거래로 넘긴 것을 둘 다 센다.",
    notes: [
      { slot: 1, kind: "role", text: "반을 돌던 종이의 경로를 따라가면 어디쯤에서 도서부의 손이 나온다." },
      { slot: 2, kind: "role", text: "도서부는 읽고, 분류하고, 넘겼다." },
      { slot: 3, kind: "role", text: "A의 이야기가 적힌 종이가 반을 돌 때, 도서부도 그걸 쥐었다 놓았다." },
      { slot: 4, kind: "name", text: "{이름}은 자기가 시작한 게 아니니 상관이 없는 일이라 생각했다." },
    ],
  },
  {
    key: "cleanup",
    no: 6,
    name: "미화부",
    branch: "slip",
    star: false,
    intro: "주변은 늘 깨끗해야 한다.",
    situation: [
      "다음 날 아침, 창고 앞 눈 위에 종이 한 장이 젖은 채로 떨어져 있었다. A가 쥐고 있던 편지였다. 주워서 찢어 버렸다. 읽지 않았다. 남의 종이를 읽는 건 예의가 아니니까.",
    ],
    goal: "쪽지 3장을 찢는다.",
    line: "이번에도 없앤다. 다만 이번에는 읽고 찢을지 읽지 않고 찢을지 본인이 정한다.",
    clauses: [
      { kind: "slipsTorn", text: "찢은 쪽지", need: 3, disclosure: "realtime" },
    ],
    footnote: "내 쪽지를 찢어도 한 장으로 센다.",
    notes: [
      { slot: 1, kind: "role", text: "아침마다 복도와 뒤뜰을 치우는 건 미화부다. 젖은 종이는 찢어서 버린다." },
      { slot: 2, kind: "name", text: "{이름}은 남의 것을 읽는 건 예의가 아니라고 생각했다." },
      { slot: 3, kind: "role", text: "그날 아침 창고 앞 눈 위에 젖은 종이가 한 장 있었다. 주운 건 미화부다." },
      { slot: 4, kind: "role", text: "미화부가 버린 것은 마지막 단서였을지도 모른다." },
    ],
  },
  {
    key: "duty",
    no: 7,
    name: "주번",
    branch: "hand",
    star: false,
    intro: "마지막으로 문을 닫고 나가야 한다.",
    situation: [
      "그 주의 주번이었다. 교실, 특별실, 창고 순으로 돌면서 불을 끄고 자물쇠를 채운다. 그날은 눈이 와서 버스가 끊길까 봐 서둘렀다. 창고 쪽에서 소리가 난 것 같았는데, 그 창고는 원래 바람이 들면 소리가 난다. 문을 열어 보지 않고 자물쇠를 채웠다.",
    ],
    goal: "문에 자물쇠를 2번 이상 채우고, 심부름을 1회 이상 한다.",
    line: "이번에는 끝까지 간다.",
    clauses: [
      { kind: "roomsLocked", text: "채운 자물쇠", need: 2, disclosure: "realtime" },
      { kind: "errandsDone", text: "완료한 심부름", need: 1, disclosure: "realtime" },
    ],
    footnote: "포기, 시간 초과, 남이 먼저 끝낸 것은 안 센다. 하루 수입 상한에 걸려 돈을 못 받아도 완료로 센다.",
    notes: [
      { slot: 1, kind: "role", text: "교실부터 창고까지 돌면서 문을 잠그는 건 그 주 주번이다." },
      { slot: 2, kind: "name", text: "{이름}은 마지막으로 학교를 나섰다." },
      { slot: 3, kind: "role", text: "창고에서 소리가 난 것 같았지만, 주번은 열어 보지 않고 자물쇠를 채웠다." },
      { slot: 4, kind: "role", text: "주번은 그날 버스가 끊길까 봐 서둘렀다." },
    ],
  },
  {
    key: "gardener",
    no: 8,
    name: "원예부",
    branch: "hand",
    star: false,
    intro: "정원 화분은 전부 이 애의 손에서 나왔다.",
    situation: [
      "정원 화분 옆에 휴대 전화 하나가 떨어져 있었다. 그 주에 A가 잃어버린 것이었다. 주워서 이름을 확인하고, 나중에 돌려주려고 서랍에 넣었다. 지금 돌려주려면 A에게 말을 걸어야 하는데 그 주에 A는 투명인간이었으니까. 월요일에 주면 되겠지 싶었다. 그날 밤 A의 휴대폰은 그 서랍 안에 있었다.",
    ],
    goal: "화분에서 3번 이상 수확한다.",
    line: "이번에는 제때 가져간다.",
    clauses: [
      { kind: "harvests", text: "수확", need: 3, disclosure: "realtime" },
    ],
    footnote: "시든 것은 수확이 아니다. 남이 심은 화분에서 따도 된다.",
    notes: [
      { slot: 1, kind: "role", text: "원예부는 매일같이 정원을 돌본다." },
      { slot: 2, kind: "name", text: "{이름}의 서랍에는 주인 없는 물건이 몇 개 들어 있다." },
      { slot: 3, kind: "role", text: "화분 옆에 떨어져 있던 A의 휴대폰을 주운 건 원예부다." },
      { slot: 4, kind: "role", text: "원예부는 월요일에 돌려주려고 했다." },
    ],
  },
  {
    key: "science",
    no: 9,
    name: "과학부",
    branch: "hand",
    star: false,
    intro: "과학실이 가장 익숙하다.",
    situation: [
      "창고 전등이 나간 건 그 주 월요일이었다. 실험 기구를 가지러 갔다가 알았다. 교체 신청서를 써서 행정실에 내면 이틀이면 갈아 준다고 했다. 신청서를 써 놓고, 내는 것을 까먹어서 내일 내려고 했다. 하지만 그대로 잊고 미뤄 버렸다.",
    ],
    goal: "로봇을 2기 이상 만든다.",
    line: "이번에는 만들어서 내놓는다.",
    clauses: [
      { kind: "robotsMade", text: "만든 로봇", need: 2, disclosure: "realtime" },
    ],
    footnote: "한도 초과로 불발되거나 환불된 연구는 안 센다.",
    notes: [
      { slot: 1, kind: "role", text: "특별실 전등이나 기구가 고장 나면 신청서를 쓰는 건 과학부다." },
      { slot: 2, kind: "name", text: "{이름}의 책상에는 아직 내지 않은 종이가 쌓여 있다." },
      { slot: 3, kind: "role", text: "그 주 창고 전등은 나가 있었다. 마지막으로 방문한 사람은 과학부다." },
      { slot: 4, kind: "role", text: "과학부는 내일 제출하려고 했다." },
    ],
  },
  {
    key: "tech",
    no: 10,
    name: "기술부",
    branch: "hand",
    star: false,
    intro: "조립보다 분해가 빠르다.",
    situation: [
      "창고 문고리는 몇 달 전부터 안에서 열리지 않았다. 청소 당번들이 몇 번이나 말했고, 그때마다 고쳐 주겠다고 했다. 공구는 있었다. 십 분이면 되는 일이었다. 다만 늘 다른 게 먼저였고 창고는 급하지 않았다. 귀찮았으니까.",
    ],
    goal: "남의 분단 로봇을 1기 이상 파괴한다.",
    line: "이번에는 미루지 않는다. 손을 대는 쪽으로.",
    clauses: [
      { kind: "robotsSmashedOfOthers", text: "무너뜨린 남의 분단 로봇", need: 1, disclosure: "realtime" },
    ],
    footnote: "이적으로 한도가 넘쳐 저절로 사라진 것은 안 센다.",
    notes: [
      { slot: 1, kind: "role", text: "반에서 뭐가 고장 나면 다들 기술부를 부른다." },
      { slot: 2, kind: "name", text: "{이름}은 손이 빠르다. 마음만 먹으면." },
      { slot: 3, kind: "role", text: "창고 문이 안에서 안 열린다는 말을 여러 번 들은 건 기술부다." },
      { slot: 4, kind: "role", text: "기술부는 십 분이면 되는 일이라고 했다." },
    ],
  },
  {
    key: "topstudent",
    no: 11,
    name: "전교 1등",
    branch: "hand",
    star: false,
    intro: "시험지를 받으면 손이 먼저 움직인다.",
    situation: [
      "A는 원래 늘 1등이었다. 투명인간이 되고 나서 성적이 무너졌다. 그 학기에 처음으로 1등을 했다. 무슨 일이 있었는지 짐작은 갔다. 물어볼 수도 있었다. 다만 물으면 그다음에 뭘 해야 할지 알 수 없었고, 지금 자리가 흔들릴 것 같았다. 성적표를 받고 축하를 받았다. 그게 다였다.",
    ],
    goal: "문제를 3개 이상 맞힌다.",
    line: "이번에도 1등을 한다. 그게 이 사람이 아는 유일한 방식이다.",
    clauses: [
      { kind: "quizzesSolved", text: "맞힌 시험지", need: 3, disclosure: "realtime" },
    ],
    footnote: "먼저 맞힌 한 사람만 센다.",
    notes: [
      { slot: 1, kind: "role", text: "반에서 전교 1등보다 앞선 적이 있는 사람은 A뿐이었다." },
      { slot: 2, kind: "role", text: "전교 1등은 시험지를 받으면 손이 먼저 움직인다." },
      { slot: 3, kind: "role", text: "A의 등수가 무너진 학기에 처음으로 1등이 된 건 전교 1등이다." },
      { slot: 4, kind: "name", text: "{이름}은 짐작이 갔지만 묻지 않았다. 물어보면 자리가 흔들릴 것 같아서." },
    ],
  },
  {
    key: "crush",
    no: 12,
    name: "짝사랑",
    branch: "astray",
    star: true,
    intro: "하루에 몇 번씩 같은 방향을 본다.",
    situation: [
      "편지를 썼다. 다섯 시, 창고에서 기다리겠다고. 네 시 반쯤 교문 앞까지 갔다가 돌아섰다. 막상 얼굴을 보면 무슨 말을 해야 할지 몰랐고 사람들이 볼까 봐 무서웠다. 방학이 끝나고 말하면 된다고 생각했다. A는 네 시 사십 분부터 거기 있었다.",
    ],
    goal: "매일 다르게 지정되는 한 사람의 쪽지를 찾아 읽는다. 그리고 그 사람과 같은 방에서 누적 15분 이상 함께 있는다.",
    line: "이번에는 그 자리에 간다.",
    clauses: [
      { kind: "targetSlipRead", text: "그 사람의 쪽지 읽기", need: 1, disclosure: "realtime" },
      { kind: "coStayWithTarget", text: "같은 방에서 함께 있은 시간", minutes: 15, disclosure: "realtime" },
    ],
    footnote: "대상은 그날 밤 운영자가 다른 분단 사람 중에서 정한다. 이름만 알려 주고 위치는 알려 주지 않는다. 대상은 모른다.",
    notes: [
      { slot: 1, kind: "role", text: "가방에 부치지 못한 편지를 넣고 다니는 건 짝사랑이다." },
      { slot: 2, kind: "name", text: "{이름}은 하루에 몇 번씩 같은 방향을 본다." },
      { slot: 3, kind: "role", text: "편지를 쓴 사람은 짝사랑이다." },
      { slot: 4, kind: "role", text: "짝사랑은 네 시 반에 교문까지 갔다가 돌아섰다." },
    ],
  },
  {
    key: "newcomer",
    no: 13,
    name: "전학생",
    branch: "astray",
    star: true,
    intro: "여기는 잠깐 머무는 곳이다.",
    situation: [
      "전에 다니던 학교에서도 비슷한 일을 겪었다. 이 학교에서 A가 처음 적혔을 때 바로 무슨 일이 일어나고 있는지 알고 있었다. 어른들에게 말했으면 한 번은 멈췄을 것이다. 다만, 전 학교에서도 고발은 무용했다. 그러니 귀찮아질 필요가 없었다. 어차피 또 얼마 지나지 않아 전학을 갈 테니까.",
    ],
    goal: "매일 밤 자정(최종 결과 제외) 우리 분단이 1위가 되면 안 된다. 그리고 다른 두 분단의 방에 각각 10분 이상 서 있어 본다.",
    line: "이번에도 어디에도 속하지 않는다.",
    clauses: [
      { kind: "teamNotFirstAtEnd", text: "우리 분단이 1위가 아님", disclosure: "daily" },
      { kind: "otherTeamRoomsStood", text: "서 있어 본 다른 분단 방", need: 2, minutes: 10, disclosure: "realtime" },
    ],
    footnote: "공동 1위도 1위다. 순위는 그날 자정의 방 개수로 본다. 방은 서 있던 그 시점의 소유 분단 기준.",
    notes: [
      { slot: 1, kind: "role", text: "전학생은 전에 다니던 학교 이야기를 절대 하지 않는다." },
      { slot: 2, kind: "role", text: "전학생은 이번 학기에 전학 왔다. 반에 녹아드는 게 이상하리만치 빨랐다." },
      { slot: 3, kind: "role", text: "전학생은 이런 광경이 낯설지 않다고 생각했다." },
      { slot: 4, kind: "name", text: "{이름}은 말하지 않았다. 이미 해 봤으니까." },
    ],
  },
  {
    key: "backseat",
    no: 14,
    name: "뒷자리",
    branch: "astray",
    star: true,
    intro: "그 자리에서는 교실 전체가 보인다.",
    situation: [
      "맨 뒷줄에 앉는다. 누가 누구를 적는지도 대충 보인다. 이번 주에 자기가 되지 않으려면 누군가를 적어야 했다. 이미 누군가가 적어 놓은 이름이 제일 안전했다. 그래서 매주 같은 이름을 적었다.",
    ],
    goal: "매일 내가 적은 이름이 투명인간이 된다.",
    line: "이번에도 적는다. 이번에는 자기 편을.",
    clauses: [
      { kind: "invisibleHits", text: "내가 적은 이름이 투명인간이 됨", need: 1, disclosure: "afterBallot" },
    ],
    footnote: "동률로 아무도 안 지워지면 못 한 것이다. 투표가 없는 마지막 날은 한 것으로 친다.",
    notes: [
      { slot: 1, kind: "role", text: "금요일이면 뒷자리 주위로 애들이 모였다가 흩어진다." },
      { slot: 2, kind: "name", text: "{이름}은 교실 전체를 다 보고 있다." },
      { slot: 3, kind: "role", text: "A의 이름이 뒷자리의 표 하나 때문에 가장 많이 나온 날도 있었다." },
      { slot: 4, kind: "role", text: "뒷자리는 한 번도 거르지 않고 적었다. 안 적으면 자기가 될 것 같아서." },
    ],
  },
]
