import { useState } from 'react'
import './theme.css'
import './SchoolApp.css'
import { SchoolGameProvider, useSchoolGame } from './state/SchoolGameContext'
import { firebaseConfigured } from '../firebase'
import { TabBar, type SchoolTabId } from './components/TabBar'
import { FirebaseSetupNotice } from './screens/FirebaseSetupNotice'
import { IntroScreen } from './screens/IntroScreen'
import { EntryScreen } from './screens/EntryScreen'
import { LobbyScreen } from './screens/LobbyScreen'
import { RoleRevealScreen } from './screens/RoleRevealScreen'
import { HomeScreen } from './screens/HomeScreen'
import { TerritoryScreen } from './screens/TerritoryScreen'
import { RosterScreen } from './screens/RosterScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { HostPanelScreen } from './screens/HostPanelScreen'
import { EndingScreen } from './screens/EndingScreen'
import { dayByNumber } from './data/days'

function Shell() {
  const { isHost, session } = useSchoolGame()
  const [activeTab, setActiveTab] = useState<SchoolTabId>('home')
  const day = dayByNumber(session.day)

  return (
    <div className="sc-shell">
      <header className="sc-shell__header">
        <span>{day.subtitle}</span>
        <span className="sc-shell__dot" />
        <span>{isHost ? '진행자' : day.title}</span>
      </header>
      <main className="sc-shell__body">
        {activeTab === 'home' && (session.phase === 'ended' ? <EndingScreen /> : <HomeScreen />)}
        {activeTab === 'territory' && <TerritoryScreen />}
        {activeTab === 'roster' && <RosterScreen />}
        {activeTab === 'profile' && !isHost && <ProfileScreen />}
        {activeTab === 'host' && isHost && <HostPanelScreen />}
      </main>
      <TabBar activeTab={activeTab} onChange={setActiveTab} isHost={isHost} />
    </div>
  )
}

function Gate() {
  const { ready, viewerId, isHost, myPlayer, roleAcked, session } = useSchoolGame()
  const [introSeen, setIntroSeen] = useState(false)

  if (!introSeen) return <IntroScreen onEnter={() => setIntroSeen(true)} />
  if (!viewerId && !isHost) return <EntryScreen />
  if (!ready) {
    return (
      <div className="sc-shell sc-shell--loading">
        <p>불러오는 중...</p>
      </div>
    )
  }
  if (session.phase === 'lobby') return <LobbyScreen />
  if (!isHost && myPlayer && !roleAcked) return <RoleRevealScreen />
  return <Shell />
}

export function SchoolApp() {
  return (
    <div className="school-root">
      {firebaseConfigured ? (
        <SchoolGameProvider>
          <Gate />
        </SchoolGameProvider>
      ) : (
        <FirebaseSetupNotice />
      )}
    </div>
  )
}
