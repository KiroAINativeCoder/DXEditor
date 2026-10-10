import { useEffect, useState, useCallback, useRef } from 'react'
import { docs as docsApi, type DocMeta } from '../lib/api'
import { statusMeta } from '../lib/rfc'
import {
  type Folder,
  getFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  getDocFolders,
  moveDocToFolder,
  getCollapsedFolderIds,
  setFolderCollapsed,
} from '../lib/folders'
import './Sidebar.css'

type Props = {
  selectedId: string | null
  onSelect: (id: string) => void
  /** Bumped by the editor when it renames/updates the open doc, to refresh. */
  refreshKey: number
}

export default function Sidebar({ selectedId, onSelect, refreshKey }: Props) {
  const [items, setItems] = useState<DocMeta[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [docFolders, setDocFolders] = useState<Record<string, string>>({})
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Creation & Editing states
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')

  // Move document popover
  const [movingDocId, setMovingDocId] = useState<string | null>(null)
  const [moveMenuPos, setMoveMenuPos] = useState<{ top: number; left: number } | null>(null)

  // Drag and drop states
  const [draggingDocId, setDraggingDocId] = useState<string | null>(null)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)

  const moveMenuRef = useRef<HTMLDivElement | null>(null)

  const loadData = useCallback(async () => {
    try {
      const list = await docsApi.list()
      setItems(list)
      setFolders(getFolders())
      setDocFolders(getDocFolders())
      setCollapsedIds(new Set(getCollapsedFolderIds()))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData, refreshKey])

  // Listen to folder updates triggered elsewhere
  useEffect(() => {
    const onFoldersUpdated = () => {
      setFolders(getFolders())
      setDocFolders(getDocFolders())
    }
    window.addEventListener('dx:folders-updated', onFoldersUpdated)
    return () => window.removeEventListener('dx:folders-updated', onFoldersUpdated)
  }, [])

  // Close move popover when clicking outside
  useEffect(() => {
    if (!movingDocId) return
    const onDocClick = (e: MouseEvent) => {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) {
        setMovingDocId(null)
        setMoveMenuPos(null)
      }
    }
    window.addEventListener('mousedown', onDocClick)
    return () => window.removeEventListener('mousedown', onDocClick)
  }, [movingDocId])

  async function handleCreateDoc(targetFolderId: string | null = null) {
    try {
      const doc = await docsApi.create('Untitled document')
      if (targetFolderId) {
        moveDocToFolder(doc.id, targetFolderId)
        // ensure target folder is expanded
        if (collapsedIds.has(targetFolderId)) {
          toggleFolder(targetFolderId)
        }
      }
      await loadData()
      onSelect(doc.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create document')
    }
  }

  async function handleDeleteDoc(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Delete this document? This cannot be undone.')) return
    await docsApi.remove(id)
    const remaining = items.filter((d) => d.id !== id)
    setItems(remaining)
    if (selectedId === id) onSelect(remaining[0]?.id ?? '')
  }

  function handleSaveNewFolder() {
    const trimmed = newFolderName.trim()
    if (!trimmed) {
      setCreatingFolder(false)
      return
    }
    const created = createFolder(trimmed)
    setFolders(getFolders())
    setNewFolderName('')
    setCreatingFolder(false)
    // Expand newly created folder
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      next.delete(created.id)
      return next
    })
  }

  function handleSaveRenameFolder(folderId: string) {
    const trimmed = editingFolderName.trim()
    if (trimmed) {
      renameFolder(folderId, trimmed)
      setFolders(getFolders())
    }
    setEditingFolderId(null)
  }

  function handleDeleteFolder(folderId: string, folderName: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (
      !confirm(
        `Delete folder "${folderName}"? Documents inside will remain safe in Unfiled Documents.`
      )
    )
      return
    deleteFolder(folderId)
    setFolders(getFolders())
    setDocFolders(getDocFolders())
  }

  function toggleFolder(folderId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      const isNowCollapsed = !next.has(folderId)
      if (isNowCollapsed) next.add(folderId)
      else next.delete(folderId)
      setFolderCollapsed(folderId, isNowCollapsed)
      return next
    })
  }

  function handleOpenMoveMenu(docId: string, e: React.MouseEvent) {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMoveMenuPos({ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 200) })
    setMovingDocId(docId)
  }

  function handleMoveDoc(docId: string, targetFolderId: string | null) {
    moveDocToFolder(docId, targetFolderId)
    setDocFolders(getDocFolders())
    setMovingDocId(null)
    setMoveMenuPos(null)
  }

  // Drag and drop handlers
  function onDragStartDoc(docId: string, e: React.DragEvent) {
    e.dataTransfer.setData('text/plain', docId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingDocId(docId)
  }

  function onDragEndDoc() {
    setDraggingDocId(null)
    setDragOverFolderId(null)
  }

  function onDropOnFolder(targetFolderId: string | null, e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const docId = e.dataTransfer.getData('text/plain') || draggingDocId
    if (docId) {
      handleMoveDoc(docId, targetFolderId)
    }
    setDragOverFolderId(null)
    setDraggingDocId(null)
  }

  // Organize documents by folders
  const folderDocsMap: Record<string, DocMeta[]> = {}
  folders.forEach((f) => {
    folderDocsMap[f.id] = []
  })
  const unfiledDocs: DocMeta[] = []

  items.forEach((item) => {
    const fId = docFolders[item.id]
    if (fId && folderDocsMap[fId]) {
      folderDocsMap[fId].push(item)
    } else {
      unfiledDocs.push(item)
    }
  })

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">Workspace</span>
        <div className="sidebar-head-actions">
          <button
            type="button"
            className="sidebar-btn-ghost"
            onClick={() => {
              setCreatingFolder(true)
              setNewFolderName('')
            }}
            title="Create new folder"
          >
            📁+ Folder
          </button>
          <button
            type="button"
            className="new-doc"
            onClick={() => handleCreateDoc(null)}
            title="New document"
          >
            + New Doc
          </button>
        </div>
      </div>

      {creatingFolder && (
        <div className="sidebar-inline-form">
          <span className="inline-folder-icon">📁</span>
          <input
            autoFocus
            type="text"
            className="sidebar-inline-input"
            placeholder="Folder name…"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveNewFolder()
              if (e.key === 'Escape') setCreatingFolder(false)
            }}
          />
          <button
            type="button"
            className="sidebar-inline-btn primary"
            onClick={handleSaveNewFolder}
          >
            ✓
          </button>
          <button
            type="button"
            className="sidebar-inline-btn"
            onClick={() => setCreatingFolder(false)}
          >
            ✕
          </button>
        </div>
      )}


      {loading && <div className="sidebar-empty">Loading documents…</div>}
      {error && <div className="sidebar-error">{error}</div>}

      <div className="sidebar-content-scroll">
        {/* FOLDERS SECTION */}
        {folders.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-label">
              <span>Folders</span>
              <span className="sidebar-count">{folders.length}</span>
            </div>

            <div className="folders-list">
              {folders.map((folder) => {
                const isCollapsed = collapsedIds.has(folder.id)
                const docList = folderDocsMap[folder.id] || []
                const isDragOver = dragOverFolderId === folder.id

                return (
                  <div key={folder.id} className="folder-item">
                    <div
                      className={`folder-head ${isDragOver ? 'is-drop-target' : ''}`}
                      onClick={() => toggleFolder(folder.id)}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setDragOverFolderId(folder.id)
                      }}
                      onDragLeave={() => {
                        if (dragOverFolderId === folder.id) setDragOverFolderId(null)
                      }}
                      onDrop={(e) => onDropOnFolder(folder.id, e)}
                    >
                      <button
                        type="button"
                        className="folder-toggle-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleFolder(folder.id)
                        }}
                      >
                        {isCollapsed ? '▸' : '▾'}
                      </button>
                      <span className="folder-icon">{isCollapsed ? '📁' : '📂'}</span>

                      {editingFolderId === folder.id ? (
                        <input
                          autoFocus
                          type="text"
                          className="folder-rename-input"
                          value={editingFolderName}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setEditingFolderName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRenameFolder(folder.id)
                            if (e.key === 'Escape') setEditingFolderId(null)
                          }}
                          onBlur={() => handleSaveRenameFolder(folder.id)}
                        />
                      ) : (
                        <span
                          className="folder-name"
                          title={folder.name}
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            setEditingFolderId(folder.id)
                            setEditingFolderName(folder.name)
                          }}
                        >
                          {folder.name}
                        </span>
                      )}

                      <span className="folder-count">{docList.length}</span>

                      <div className="folder-quick-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="folder-action-btn"
                          title="New document in this folder"
                          onClick={() => handleCreateDoc(folder.id)}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className="folder-action-btn"
                          title="Rename folder"
                          onClick={() => {
                            setEditingFolderId(folder.id)
                            setEditingFolderName(folder.name)
                          }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="folder-action-btn danger"
                          title="Delete folder"
                          onClick={(e) => handleDeleteFolder(folder.id, folder.name, e)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {!isCollapsed && (
                      <ul
                        className="folder-doc-list"
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverFolderId(folder.id)
                        }}
                        onDrop={(e) => onDropOnFolder(folder.id, e)}
                      >
                        {docList.length === 0 ? (
                          <li className="folder-empty-hint">Drop docs or click + to add</li>
                        ) : (
                          docList.map((d) => (
                            <li
                              key={d.id}
                              draggable
                              onDragStart={(e) => onDragStartDoc(d.id, e)}
                              onDragEnd={onDragEndDoc}
                              className={`doc-item in-folder ${d.id === selectedId ? 'is-selected' : ''} ${
                                draggingDocId === d.id ? 'is-dragging' : ''
                              }`}
                              onClick={() => onSelect(d.id)}
                            >
                              <span className="doc-icon">📄</span>
                              <div className="doc-item-main">
                                <span className="doc-item-title">{d.title || 'Untitled document'}</span>
                                {d.status && d.status !== 'DRAFT' && (
                                  <span className="doc-tag doc-tag-status" style={{ color: statusMeta(d.status).color }}>
                                    <span className="doc-tag-dot" style={{ background: statusMeta(d.status).color }} />
                                    {statusMeta(d.status).label}
                                  </span>
                                )}
                              </div>
                              <div className="doc-item-actions">
                                <button
                                  type="button"
                                  className="doc-move-btn"
                                  title="Move to another folder"
                                  onClick={(e) => handleOpenMoveMenu(d.id, e)}
                                >
                                  📁
                                </button>
                                <button
                                  type="button"
                                  className="doc-del"
                                  title="Delete document"
                                  onClick={(e) => handleDeleteDoc(d.id, e)}
                                >
                                  ✕
                                </button>
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* UNFILED / ROOT DOCUMENTS SECTION */}
        <div className="sidebar-section">
          <div
            className={`sidebar-section-label unfiled-header ${
              dragOverFolderId === 'unfiled' ? 'is-drop-target' : ''
            }`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverFolderId('unfiled')
            }}
            onDragLeave={() => {
              if (dragOverFolderId === 'unfiled') setDragOverFolderId(null)
            }}
            onDrop={(e) => onDropOnFolder(null, e)}
          >
            <span>{folders.length > 0 ? 'Other Documents' : 'Documents'}</span>
            <span className="sidebar-count">{unfiledDocs.length}</span>
          </div>

          <ul
            className="doc-list"
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverFolderId('unfiled')
            }}
            onDrop={(e) => onDropOnFolder(null, e)}
          >
            {unfiledDocs.map((d) => (
              <li
                key={d.id}
                draggable
                onDragStart={(e) => onDragStartDoc(d.id, e)}
                onDragEnd={onDragEndDoc}
                className={`doc-item ${d.id === selectedId ? 'is-selected' : ''} ${
                  draggingDocId === d.id ? 'is-dragging' : ''
                }`}
                onClick={() => onSelect(d.id)}
              >
                <span className="doc-icon">📄</span>
                <div className="doc-item-main">
                  <span className="doc-item-title">{d.title || 'Untitled document'}</span>
                  {d.status && d.status !== 'DRAFT' && (
                    <span className="doc-tag doc-tag-status" style={{ color: statusMeta(d.status).color }}>
                      <span className="doc-tag-dot" style={{ background: statusMeta(d.status).color }} />
                      {statusMeta(d.status).label}
                    </span>
                  )}
                </div>
                <div className="doc-item-actions">
                  <button
                    type="button"
                    className="doc-move-btn"
                    title="Move to folder"
                    onClick={(e) => handleOpenMoveMenu(d.id, e)}
                  >
                    📁
                  </button>
                  <button
                    type="button"
                    className="doc-del"
                    title="Delete document"
                    onClick={(e) => handleDeleteDoc(d.id, e)}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}

            {!loading && !error && items.length === 0 && (
              <li className="sidebar-empty">No documents yet. Create one.</li>
            )}
          </ul>
        </div>
      </div>

      {/* MOVE TO FOLDER POPOVER DROPDOWN */}
      {movingDocId && moveMenuPos && (
        <div
          ref={moveMenuRef}
          className="move-folder-popover"
          style={{ top: moveMenuPos.top, left: moveMenuPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="move-popover-header">Move document to:</div>
          <div className="move-popover-list">
            <button
              type="button"
              className={`move-popover-item ${!docFolders[movingDocId] ? 'is-active' : ''}`}
              onClick={() => handleMoveDoc(movingDocId, null)}
            >
              <span className="move-item-icon">📄</span>
              <span className="move-item-name">Unfiled (No folder)</span>
              {!docFolders[movingDocId] && <span className="move-item-check">✓</span>}
            </button>

            {folders.map((f) => {
              const isCurrent = docFolders[movingDocId] === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`move-popover-item ${isCurrent ? 'is-active' : ''}`}
                  onClick={() => handleMoveDoc(movingDocId, f.id)}
                >
                  <span className="move-item-icon">📁</span>
                  <span className="move-item-name">{f.name}</span>
                  {isCurrent && <span className="move-item-check">✓</span>}
                </button>
              )
            })}
          </div>
          <div className="move-popover-footer">
            <button
              type="button"
              className="move-popover-new-btn"
              onClick={() => {
                const name = prompt('New folder name:')
                if (name && name.trim()) {
                  const created = createFolder(name.trim())
                  handleMoveDoc(movingDocId, created.id)
                }
              }}
            >
              + Create new folder…
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
