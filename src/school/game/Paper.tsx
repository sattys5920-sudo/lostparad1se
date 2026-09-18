// 구겨진 종이 한 장 — 아홉 조각으로 붙인다.
//
// 로그인 화면과 투표 화면이 **같은 종이를 쓴다.** 두 군데에 같은 조각을
// 따로 붙여 두면 한쪽 구김만 고쳐지는 날이 온다.
//
// 조각의 크기(모서리 56px · 가장자리 28px)는 CSS 가 정한다. 여기서는
// 어느 자리에 무엇을 붙일지만 정한다.
import { paperSlice } from './paperArt'

export interface PaperSheetProps {
  /** 클래스 앞머리. `sc-gt` 를 주면 `sc-gt__sheet` 로 나간다. */
  cls: string
}

export function PaperSheet({ cls }: PaperSheetProps) {
  return (
    <div className={`${cls}__sheet`} aria-hidden="true">
      <span className={`${cls}__flat`} />
      <span className={`${cls}__e ${cls}__e--t`} style={{ backgroundImage: `url(${paperSlice('ET')})` }} />
      <span className={`${cls}__e ${cls}__e--b`} style={{ backgroundImage: `url(${paperSlice('EB')})` }} />
      <span className={`${cls}__e ${cls}__e--l`} style={{ backgroundImage: `url(${paperSlice('EL')})` }} />
      <span className={`${cls}__e ${cls}__e--r`} style={{ backgroundImage: `url(${paperSlice('ER')})` }} />
      <span className={`${cls}__c ${cls}__c--tl`} style={{ backgroundImage: `url(${paperSlice('TL')})` }} />
      <span className={`${cls}__c ${cls}__c--tr`} style={{ backgroundImage: `url(${paperSlice('TR')})` }} />
      <span className={`${cls}__c ${cls}__c--bl`} style={{ backgroundImage: `url(${paperSlice('BL')})` }} />
      <span className={`${cls}__c ${cls}__c--br`} style={{ backgroundImage: `url(${paperSlice('BR')})` }} />
    </div>
  )
}
