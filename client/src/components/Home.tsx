import { useEffect, useState } from 'react'
import { docs as docsApi, folders as foldersApi, type DocMeta, type Folder } from '../lib/api'
import './Home.css'

type Props = {
  userName: string
  /** Bumped when docs/folders change elsewhere, to refresh the home view. */
  refreshKey: number
  onOpen: (id: string) => void
  onNewDoc: () => void
  onNewFolder: () => void
}

function when(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  if (d < 7) return `${d} days ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function Home({ userName, refreshKey, onOpen, onNewDoc, onNewFolder }: Props) {
  const [items, setItems] = useState<DocMeta[]>([])
  const [folderList, setFolderList] = useState<Folder[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all([docsApi.list(), foldersApi.list().catch(() => [] as Folder[])]).then(([d, f]) => {
      if (cancelled) return
      setItems(d)
      setFolderList(f)
    })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const recent = items.slice(0, 8) // list() is already ordered by updated_at desc
  const countIn = (fid: string | null) => items.filter((d) => (d.folder_id ?? null) === fid).length

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-header">
          <h1 className="home-greeting">Welcome back, {userName} 👋</h1>
          <p className="home-sub">
            {items.length} document{items.length === 1 ? '' : 's'} ·{' '}
            {folderList.length} folder{folderList.length === 1 ? '' : 's'}
          </p>
        </header>

        <div className="home-actions">
          <button className="home-action primary" onClick={onNewDoc}>
            <span className="ha-icon">📄</span> New document
          </button>
          <button className="home-action" onClick={onNewFolder}>
            <span className="ha-icon">📁</span> New folder
          </button>
        </div>

        <section className="home-section">
          <h2 className="home-section-title">Recent documents</h2>
          {recent.length === 0 ? (
            <div className="home-empty">No documents yet. Create your first one above.</div>
          ) : (
            <div className="home-grid">
              {recent.map((d) => (
                <button key={d.id} className="home-card" onClick={() => onOpen(d.id)}>
                  <span className="hc-title">{d.title || 'Untitled document'}</span>
                  <span className="hc-meta">Edited {when(d.updated_at)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {folderList.length > 0 && (
          <section className="home-section">
            <h2 className="home-section-title">Folders</h2>
            <div className="home-grid">
              {folderList.map((f) => (
                <div key={f.id} className="home-folder">
                  <span className="hf-name">📁 {f.name}</span>
                  <span className="hf-count">{countIn(f.id)} doc{countIn(f.id) === 1 ? '' : 's'}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
