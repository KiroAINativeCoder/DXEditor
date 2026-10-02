import { useEffect, useState } from 'react'
import { versions as versionsApi, ApiError, type DocVersion } from '../lib/api'
import './VersionPanel.css'

type Props = {
  docId: string
  canEdit: boolean
  /** Capture the current Yjs state as a base64 update string. */
  snapshot: () => string | null
  /** Apply a base64 Yjs update onto the live document (restore). */
  applyUpdate: (base64: string) => void
  onClose: () => void
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function VersionPanel({ docId, canEdit, snapshot, applyUpdate, onClose }: Props) {
  const [list, setList] = useState<DocVersion[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setList(await versionsApi.list(docId))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load versions')
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  async function save() {
    setError(null)
    const update = snapshot()
    if (!update) {
      setError('Document not ready yet')
      return
    }
    const label = window.prompt('Name this version (optional):') ?? undefined
    setBusy(true)
    try {
      await versionsApi.create(docId, update, label || undefined)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save version')
    } finally {
      setBusy(false)
    }
  }

  async function restore(v: DocVersion) {
    if (!window.confirm('Restore this version? Current content will be replaced by it.')) return
    setBusy(true)
    try {
      const full = await versionsApi.get(docId, v.id)
      applyUpdate(full.update)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to restore')
    } finally {
      setBusy(false)
    }
  }

  async function remove(v: DocVersion) {
    if (!window.confirm('Delete this version?')) return
    try {
      await versionsApi.remove(docId, v.id)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete')
    }
  }

  return (
    <aside className="version-panel">
      <div className="version-head">
        <span className="version-title">Version history</span>
        <button className="version-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {canEdit && (
        <button className="version-save" disabled={busy} onClick={save}>
          Save current version
        </button>
      )}

      {error && <div className="version-error">{error}</div>}

      {list.length === 0 ? (
        <div className="version-empty">No saved versions yet.</div>
      ) : (
        <ul className="version-list">
          {list.map((v) => (
            <li key={v.id} className="version-row">
              <div className="version-info">
                <span className="version-label">{v.label || 'Version'}</span>
                <span className="version-meta">
                  {when(v.created_at)}
                  {v.author?.email ? ` · ${v.author.name || v.author.email}` : ''}
                </span>
              </div>
              {canEdit && (
                <div className="version-actions">
                  <button className="vbtn" disabled={busy} onClick={() => restore(v)}>Restore</button>
                  <button className="vbtn vbtn-del" onClick={() => remove(v)}>Delete</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
