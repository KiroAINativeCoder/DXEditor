import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Editor from './components/Editor'
import Home from './components/Home'
import Auth from './components/Auth'
import ShareDialog from './components/ShareDialog'
import { auth, docs, folders, type User, type DocDetail } from './lib/api'
import './App.css'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DocDetail | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [sharing, setSharing] = useState(false)

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
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setSelectedId(null))
    return () => {
      cancelled = true
    }
  }, [selectedId, user, refreshKey])

  async function logout() {
    await auth.signOut().catch(() => undefined)
    setUser(null)
    setSelectedId(null)
    setDetail(null)
  }

  async function newDocument() {
    const doc = await docs.create('Untitled document')
    setRefreshKey((k) => k + 1)
    setSelectedId(doc.id)
  }
  async function newFolder() {
    const name = window.prompt('Folder name:')
    if (name === null) return
    await folders.create(name || 'New folder')
    setRefreshKey((k) => k + 1)
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
        <div className="brand" onClick={() => setSelectedId(null)} style={{ cursor: 'pointer' }} title="Home">
          <span className="brand-mark">DX</span>
          <span className="brand-name">DXEditor</span>
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
          <span className="user-email">{user.name || user.email}</span>
          <button className="header-btn ghost" onClick={logout}>Log out</button>
        </div>
      </header>
      <div className="app-body">
        <Sidebar
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id || null)}
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
              onOpen={(id) => setSelectedId(id)}
              onNewDoc={newDocument}
              onNewFolder={newFolder}
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
