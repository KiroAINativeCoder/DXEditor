import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Editor from './components/Editor'
import { api, type DocMeta } from './lib/api'
import './App.css'

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [meta, setMeta] = useState<DocMeta | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [apiDown, setApiDown] = useState(false)

  // Load the selected doc's metadata (for the title) whenever selection changes.
  useEffect(() => {
    if (!selectedId) {
      setMeta(null)
      return
    }
    let cancelled = false
    api
      .get(selectedId)
      .then((d) => {
        if (!cancelled) {
          setMeta(d)
          setApiDown(false)
        }
      })
      .catch(() => !cancelled && setApiDown(true))
    return () => {
      cancelled = true
    }
  }, [selectedId, refreshKey])

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">DX</span>
          <span className="brand-name">DXEditor</span>
        </div>
        <span className="phase-tag">Phase 4 · documents</span>
      </header>
      <div className="app-body">
        <Sidebar
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id || null)}
          refreshKey={refreshKey}
        />
        <main className="app-main">
          {apiDown ? (
            <div className="app-placeholder app-error">
              Could not reach the API at{' '}
              <code>{import.meta.env.VITE_API_URL ?? 'http://localhost:4000'}</code>.
              <br />
              Start it: <code>cd server &amp;&amp; npm run dev</code>
            </div>
          ) : selectedId && meta ? (
            <Editor
              key={selectedId}
              docId={selectedId}
              initialTitle={meta.title}
              onTitleSaved={() => setRefreshKey((k) => k + 1)}
            />
          ) : (
            <div className="app-placeholder">
              Select a document, or create one from the sidebar.
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
