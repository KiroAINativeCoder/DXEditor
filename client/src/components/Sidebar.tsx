import { useEffect, useState, useCallback } from 'react'
import { api, type DocMeta } from '../lib/api'
import './Sidebar.css'

type Props = {
  selectedId: string | null
  onSelect: (id: string) => void
  /** Bumped by the editor when it renames the open doc, to refresh titles. */
  refreshKey: number
}

export default function Sidebar({ selectedId, onSelect, refreshKey }: Props) {
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await api.list()
      setDocs(list)
      setError(null)
      // Auto-select the first doc if none is selected.
      if (!selectedId && list.length) onSelect(list[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }, [selectedId, onSelect])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function createDoc() {
    const doc = await api.create('Untitled document')
    await load()
    onSelect(doc.id)
  }

  async function deleteDoc(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Delete this document? This cannot be undone.')) return
    await api.remove(id)
    const remaining = docs.filter((d) => d.id !== id)
    setDocs(remaining)
    if (selectedId === id) onSelect(remaining[0]?.id ?? '')
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">Documents</span>
        <button className="new-doc" onClick={createDoc} title="New document">
          + New
        </button>
      </div>

      {loading && <div className="sidebar-empty">Loading…</div>}
      {error && <div className="sidebar-error">{error}</div>}
      {!loading && !error && docs.length === 0 && (
        <div className="sidebar-empty">No documents yet. Create one.</div>
      )}

      <ul className="doc-list">
        {docs.map((d) => (
          <li
            key={d.id}
            className={`doc-item${d.id === selectedId ? ' is-selected' : ''}`}
            onClick={() => onSelect(d.id)}
          >
            <span className="doc-item-title">{d.title || 'Untitled document'}</span>
            <button
              className="doc-del"
              title="Delete"
              onClick={(e) => deleteDoc(d.id, e)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
