import { useEffect, useState } from 'react'
import { shares as sharesApi, ApiError, type Share, type Role } from '../lib/api'
import './ShareDialog.css'

type ShareRole = 'VIEWER' | 'EDITOR' | 'MANAGER'

const roleLabel: Record<ShareRole, string> = {
  VIEWER: 'Can view',
  EDITOR: 'Can edit',
  MANAGER: 'Can manage',
}

export default function ShareDialog({
  docId,
  isOwner,
  onClose,
}: {
  docId: string
  isOwner: boolean
  onClose: () => void
}) {
  const [list, setList] = useState<Share[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ShareRole>('EDITOR')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      setList(await sharesApi.list(docId))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load shares')
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await sharesApi.add(docId, email, role as Role)
      setEmail('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to share')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(userId: string) {
    await sharesApi.remove(docId, userId)
    await load()
  }

  return (
    <div className="share-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="share-head">
          <h2>Share document</h2>
          <button className="share-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form className="share-add" onSubmit={add}>
          <input
            type="email"
            required
            placeholder="Person's email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as ShareRole)}>
            <option value="EDITOR">Can edit</option>
            <option value="VIEWER">Can view</option>
            {/* Only the owner may grant the manage (share) capability. */}
            {isOwner && <option value="MANAGER">Can manage</option>}
          </select>
          <button type="submit" disabled={busy}>Share</button>
        </form>

        {error && <div className="share-error">{error}</div>}

        <ul className="share-list">
          {list.length === 0 && <li className="share-empty">Not shared with anyone yet.</li>}
          {list.map((s) => (
            <li key={s.id} className="share-row">
              <span className="share-who">
                {s.user.name || s.user.email}
                <small>{s.user.email}</small>
              </span>
              <span className="share-role">{roleLabel[s.role as ShareRole]}</span>
              <button className="share-revoke" onClick={() => revoke(s.user.id)}>Remove</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
