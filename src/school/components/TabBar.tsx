import './TabBar.css'

export type SchoolTabId = 'home' | 'territory' | 'roster' | 'profile' | 'host'

interface Tab {
  id: SchoolTabId
  label: string
}

const PLAYER_TABS: Tab[] = [
  { id: 'home', label: '교실' },
  { id: 'territory', label: '영역' },
  { id: 'roster', label: '아이들' },
  { id: 'profile', label: '프로필' },
]

const HOST_TABS: Tab[] = [
  { id: 'home', label: '교실' },
  { id: 'territory', label: '영역' },
  { id: 'roster', label: '아이들' },
  { id: 'host', label: '진행' },
]

export function TabBar({
  activeTab,
  onChange,
  isHost,
}: {
  activeTab: SchoolTabId
  onChange: (tab: SchoolTabId) => void
  isHost: boolean
}) {
  const tabs = isHost ? HOST_TABS : PLAYER_TABS
  return (
    <nav className="sc-tabbar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`sc-tabbar__item ${activeTab === tab.id ? 'is-active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
