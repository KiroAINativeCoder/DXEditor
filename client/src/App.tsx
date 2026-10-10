import { useEffect, useState, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import Editor from './components/Editor'
import Home from './components/Home'
import Auth from './components/Auth'
import ShareDialog from './components/ShareDialog'
import { auth, docs, type User, type DocDetail } from './lib/api'
import { pushRecent } from './lib/recent'
import './App.css'

// Read the current document id from the URL (/doc/:id), or null for home (/).
function idFromPath(): string | null {
  const m = window.location.pathname.match(/^\/doc\/([^/]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('dx_theme') as 'light' | 'dark') || 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('dx_theme', theme)
  }, [theme])

  // Selection is driven by the URL so every document is shareable by link.
  const [selectedId, setSelectedId] = useState<string | null>(idFromPath())
  const [detail, setDetail] = useState<DocDetail | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [sharing, setSharing] = useState(false)

  // Navigate: push a new URL and update selection. Passing null goes home (/).
  const navigate = useCallback((id: string | null) => {
    const path = id ? `/doc/${encodeURIComponent(id)}` : '/'
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
    setSelectedId(id)
  }, [])

  // Keep selection in sync with browser back/forward.
  useEffect(() => {
    const onPop = () => setSelectedId(idFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // On load, check for an existing session.
  useEffect(() => {
    auth
      .current()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true))
  }, [])

  // Load the selected doc's detail (title + role) when selection changes.
  useEffect(() => {
    if (!selectedId || !user) {
      setDetail(null)
      return
    }
    let cancelled = false
    docs
      .get(selectedId)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        pushRecent(d.id)
      })
      .catch(() => {
        if (cancelled) return
        // Unknown / inaccessible id in the URL — fall back to home.
        setDetail(null)
        navigate(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, user, refreshKey, navigate])

  async function logout() {
    await auth.signOut().catch(() => undefined)
    setUser(null)
    navigate(null)
    setDetail(null)
  }

  async function newDocument() {
    const doc = await docs.create('Untitled document')
    setRefreshKey((k) => k + 1)
    navigate(doc.id)
  }

  const canShare = detail && (detail.role === 'OWNER' || detail.role === 'MANAGER')
  const roleLabel =
    detail?.role === 'MANAGER'
      ? 'Shared · can manage'
      : detail?.role === 'EDITOR'
        ? 'Shared · can edit'
        : 'Shared · view only'

  if (!authChecked) return <div className="app-boot">Loading…</div>
  if (!user) return <Auth onAuthed={setUser} />

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand" onClick={() => navigate(null)} style={{ cursor: 'pointer' }} title="Home">
          <span className="brand-mark">DD</span>
          <span className="brand-name">DevDocs</span>
        </div>
        {canShare && (
          <button className="header-btn share-primary" onClick={() => setSharing(true)}>
            Share
          </button>
        )}
        {detail && detail.role !== 'OWNER' && (
          <span className="role-badge">{roleLabel}</span>
        )}
        <div className="header-user">
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <span className="user-email">{user.name || user.email}</span>
          <button className="header-btn ghost" onClick={logout}>Log out</button>
        </div>
      </header>
      <div className="app-body">
        <Sidebar
          selectedId={selectedId}
          onSelect={(id) => navigate(id || null)}
          refreshKey={refreshKey}
        />
        <main className="app-main">
          {selectedId && detail ? (
            <Editor
              key={selectedId}
              docId={selectedId}
              initialTitle={detail.title}
              role={detail.role}
              currentUserId={user.id}
              onTitleSaved={() => setRefreshKey((k) => k + 1)}
            />
          ) : (
            <Home
              userName={user.name || user.email}
              refreshKey={refreshKey}
              onOpen={(id) => navigate(id)}
              onNewDoc={newDocument}
            />
          )}
        </main>
      </div>
      {sharing && selectedId && detail && (
        <ShareDialog docId={selectedId} isOwner={detail.role === 'OWNER'} onClose={() => setSharing(false)} />
      )}
    </div>
  )
}
