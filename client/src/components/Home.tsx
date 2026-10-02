import { useEffect, useState } from 'react'
import { docs as docsApi, type DocMeta } from '../lib/api'
import { getRecentIds } from '../lib/recent'
import './Home.css'

type Props = {
  userName: string
  refreshKey: number
  onOpen: (id: string) => void
  onNewDoc: () => void
}

function when(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400000)
  if (d <= 0) return 'Today'
  if (d === 1) return 'Yesterday'
  if (d < 7) return `${d} days ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function initial(name: string) {
  return (name.trim()[0] || '?').toUpperCase()
}

export default function Home({ userName, refreshKey, onOpen, onNewDoc }: Props) {
  const [items, setItems] = useState<DocMeta[]>([])
  const [recentIds, setRecentIds] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    docsApi.list().then((d) => !cancelled && setItems(d))
    setRecentIds(getRecentIds())
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const byId = new Map(items.map((d) => [d.id, d]))
  // Recently viewed: ids from localStorage that still exist, in view order.
  const recent = recentIds.map((id) => byId.get(id)).filter(Boolean).slice(0, 6) as DocMeta[]

  function Card({ d, sub }: { d: DocMeta; sub: string }) {
    return (
      <button className="home-card" onClick={() => onOpen(d.id)}>
        <span className="hc-icon">📄</span>
        <span className="hc-title">{d.title || 'Untitled document'}</span>
        <span className="hc-meta">{sub}</span>
      </button>
    )
  }

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  })()

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-header">
          <span className="home-avatar">{initial(userName)}</span>
          <div>
            <h1 className="home-greeting">Hi, {userName} 👋</h1>
            <p className="home-sub">{greeting} — pick up where you left off, or start something new.</p>
          </div>
          <button className="home-new" onClick={onNewDoc}>+ New document</button>
        </header>

        {recent.length > 0 && (
          <section className="home-section">
            <h2 className="home-section-title">Recently viewed</h2>
            <div className="home-grid">
              {recent.map((d) => <Card key={d.id} d={d} sub={`Edited ${when(d.updated_at)}`} />)}
            </div>
          </section>
        )}

        <section className="home-section">
          <h2 className="home-section-title">All documents</h2>
          {items.length === 0 ? (
            <div className="home-empty">
              No documents yet. <button className="home-link" onClick={onNewDoc}>Create your first one</button>.
            </div>
          ) : (
            <div className="home-grid">
              {items.map((d) => <Card key={d.id} d={d} sub={`Edited ${when(d.updated_at)}`} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
