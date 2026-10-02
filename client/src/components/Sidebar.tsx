import { useEffect, useState, useCallback } from 'react'
import { docs as docsApi, folders as foldersApi, type DocMeta, type Folder } from '../lib/api'
import './Sidebar.css'

type Props = {
  selectedId: string | null
  onSelect: (id: string) => void
  /** Bumped by the editor when it renames the open doc, to refresh titles. */
  refreshKey: number
}

export default function Sidebar({ selectedId, onSelect, refreshKey }: Props) {
  const [items, setItems] = useState<DocMeta[]>([])
  const [folderList, setFolderList] = useState<Folder[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await docsApi.list()
      setItems(list)
      // Folders are a newer feature; if the table isn't migrated yet, don't
      // let that break the document list.
      const fl = await foldersApi.list().catch(() => [] as Folder[])
      setFolderList(fl)
      setError(null)
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

  async function createDoc(folderId: string | null) {
    const doc = await docsApi.create('Untitled document', folderId)
    await load()
    onSelect(doc.id)
  }

  async function createFolder() {
    const name = window.prompt('Folder name:')
    if (name === null) return
    await foldersApi.create(name || 'New folder')
    await load()
  }

  async function renameFolder(f: Folder, e: React.MouseEvent) {
    e.stopPropagation()
    const name = window.prompt('Rename folder:', f.name)
    if (name === null || !name.trim()) return
    await foldersApi.rename(f.id, name.trim())
    await load()
  }

  async function deleteFolder(f: Folder, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete folder "${f.name}"? Its documents will be moved to Unfiled.`)) return
    await foldersApi.remove(f.id)
    await load()
  }

  async function deleteDoc(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Delete this document? This cannot be undone.')) return
    await docsApi.remove(id)
    const remaining = items.filter((d) => d.id !== id)
    setItems(remaining)
    if (selectedId === id) onSelect(remaining[0]?.id ?? '')
  }

  async function moveDoc(id: string, folderId: string | null) {
    await docsApi.move(id, folderId)
    await load()
  }

  function toggle(key: string) {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }))
  }

  function docsIn(folderId: string | null) {
    return items.filter((d) => (d.folder_id ?? null) === folderId)
  }

  function DocRow({ d }: { d: DocMeta }) {
    return (
      <li
        className={`doc-item${d.id === selectedId ? ' is-selected' : ''}`}
        onClick={() => onSelect(d.id)}
      >
        <span className="doc-item-title">{d.title || 'Untitled document'}</span>
        <select
          className="doc-move"
          title="Move to folder"
          value={d.folder_id ?? ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => moveDoc(d.id, e.target.value || null)}
        >
          <option value="">Unfiled</option>
          {folderList.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <button className="doc-del" title="Delete" onClick={(e) => deleteDoc(d.id, e)}>✕</button>
      </li>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">Documents</span>
        <div className="sidebar-head-actions">
          <button className="new-folder" onClick={createFolder} title="New folder">+ Folder</button>
          <button className="new-doc" onClick={() => createDoc(null)} title="New document">+ New</button>
        </div>
      </div>

      {loading && <div className="sidebar-empty">Loading…</div>}
      {error && <div className="sidebar-error">{error}</div>}
      {!loading && !error && items.length === 0 && folderList.length === 0 && (
        <div className="sidebar-empty">No documents yet. Create one.</div>
      )}

      {!loading && !error && (
        <div className="tree">
          {/* Folders */}
          {folderList.map((f) => {
            const docsHere = docsIn(f.id)
            const isCollapsed = collapsed[f.id]
            return (
              <div key={f.id} className="folder">
                <div className="folder-head" onClick={() => toggle(f.id)}>
                  <span className="folder-caret">{isCollapsed ? '▸' : '▾'}</span>
                  <span className="folder-name">📁 {f.name}</span>
                  <span className="folder-count">{docsHere.length}</span>
                  <button className="folder-act" title="New doc here"
                    onClick={(e) => { e.stopPropagation(); createDoc(f.id) }}>+</button>
                  <button className="folder-act" title="Rename" onClick={(e) => renameFolder(f, e)}>✎</button>
                  <button className="folder-act" title="Delete folder" onClick={(e) => deleteFolder(f, e)}>🗑</button>
                </div>
                {!isCollapsed && (
                  <ul className="doc-list nested">
                    {docsHere.length === 0 && <li className="folder-empty">Empty</li>}
                    {docsHere.map((d) => <DocRow key={d.id} d={d} />)}
                  </ul>
                )}
              </div>
            )
          })}

          {/* Unfiled */}
          <div className="folder">
            <div className="folder-head" onClick={() => toggle('__unfiled')}>
              <span className="folder-caret">{collapsed['__unfiled'] ? '▸' : '▾'}</span>
              <span className="folder-name">Unfiled</span>
              <span className="folder-count">{docsIn(null).length}</span>
            </div>
            {!collapsed['__unfiled'] && (
              <ul className="doc-list nested">
                {docsIn(null).map((d) => <DocRow key={d.id} d={d} />)}
              </ul>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
