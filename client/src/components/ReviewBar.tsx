import { useCallback, useEffect, useState } from 'react'
import {
  reviews as reviewsApi,
  reviewers as reviewersApi,
  shares as sharesApi,
  type Review,
  type DocReviewer,
  type Share,
} from '../lib/api'
import './ReviewBar.css'

type Props = {
  docId: string
  currentUserId: string
  /** Owner/MANAGER may add/remove mandatory reviewers. */
  canManage: boolean
  refreshKey?: number
  /**
   * Fired after any review change with the mandatory-reviewer consensus:
   *   'approved' — ≥1 mandatory reviewer, ALL approved, none requested changes
   *   'changes'  — a mandatory reviewer requested changes
   *   'none'     — otherwise (still waiting on someone)
   */
  onConsensus?: (verdict: 'approved' | 'changes' | 'none') => void
}

// Review controls, shown only while a doc is IN_REVIEW. Mandatory reviewers are
// named people (chosen from the doc's members); a doc is accepted when every
// mandatory reviewer has approved and none has requested changes.
export default function ReviewBar({ docId, currentUserId, canManage, refreshKey = 0, onConsensus }: Props) {
  const [revs, setRevs] = useState<Review[]>([])
  const [required, setRequired] = useState<DocReviewer[]>([])
  const [members, setMembers] = useState<Share[]>([])
  const [busy, setBusy] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)

  // state of a given user's review, if any
  const stateOf = (userId: string) =>
    revs.find((r) => r.reviewer?.id === userId)?.state ?? null

  const verdictOf = (reviewList: Review[], reqList: DocReviewer[]): 'approved' | 'changes' | 'none' => {
    const stateFor = (uid: string) => reviewList.find((r) => r.reviewer?.id === uid)?.state ?? null
    if (reqList.some((r) => stateFor(r.user.id) === 'CHANGES_REQUESTED')) return 'changes'
    if (reqList.length > 0 && reqList.every((r) => stateFor(r.user.id) === 'APPROVED')) return 'approved'
    return 'none'
  }

  const load = useCallback(async () => {
    const [r, req] = await Promise.all([
      reviewsApi.list(docId).catch(() => [] as Review[]),
      reviewersApi.list(docId).catch(() => [] as DocReviewer[]),
    ])
    setRevs(r)
    setRequired(req)
    return { r, req }
  }, [docId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  // Members available to add as reviewers (loaded lazily when the picker opens).
  const openPicker = useCallback(async () => {
    setPickOpen((v) => !v)
    if (members.length === 0) {
      try {
        setMembers(await sharesApi.list(docId))
      } catch {
        /* ignore */
      }
    }
  }, [docId, members.length])

  const iAmRequired = required.some((r) => r.user.id === currentUserId)
  const myState = stateOf(currentUserId)

  const submit = useCallback(
    async (state: 'APPROVED' | 'CHANGES_REQUESTED') => {
      setBusy(true)
      try {
        if (myState === state) await reviewsApi.withdraw(docId)
        else await reviewsApi.submit(docId, state)
        const { r, req } = await load()
        onConsensus?.(verdictOf(r, req))
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, myState, load, onConsensus],
  )

  const addReviewer = useCallback(
    async (userId: string) => {
      setBusy(true)
      try {
        await reviewersApi.add(docId, userId)
        const { r, req } = await load()
        onConsensus?.(verdictOf(r, req))
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, load, onConsensus],
  )

  const removeReviewer = useCallback(
    async (userId: string) => {
      setBusy(true)
      try {
        await reviewersApi.remove(docId, userId)
        const { r, req } = await load()
        onConsensus?.(verdictOf(r, req))
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, load, onConsensus],
  )

  const name = (u: { name?: string | null; email?: string | null }) => u.name || u.email || 'Unknown'
  const approvedCount = required.filter((r) => stateOf(r.user.id) === 'APPROVED').length
  // Candidate members not already required (and not the picker's own noise).
  const candidates = members.filter((m) => !required.some((r) => r.user.id === m.user.id))

  return (
    <div className="review-bar">
      {/* Mandatory reviewers + their state */}
      <div className="rv-reviewers">
        {required.length === 0 && <span className="rv-empty">No required reviewers</span>}
        {required.map((r) => {
          const st = stateOf(r.user.id)
          return (
            <span
              key={r.id}
              className={`rv-chip${st === 'APPROVED' ? ' is-approved' : st === 'CHANGES_REQUESTED' ? ' is-changes' : ''}`}
              title={st === 'APPROVED' ? 'Approved' : st === 'CHANGES_REQUESTED' ? 'Requested changes' : 'Pending'}
            >
              {st === 'APPROVED' ? '✓' : st === 'CHANGES_REQUESTED' ? '✎' : '•'} {name(r.user)}
              {canManage && (
                <button className="rv-chip-x" disabled={busy} onClick={() => removeReviewer(r.user.id)}>
                  ✕
                </button>
              )}
            </span>
          )
        })}
        {required.length > 0 && (
          <span className="rv-progress" title="Approved / required">
            {approvedCount}/{required.length}
          </span>
        )}
      </div>

      {canManage && (
        <div className="rv-add-wrap">
          <button className="rv-add" disabled={busy} onClick={openPicker}>
            + Reviewer
          </button>
          {pickOpen && (
            <div className="rv-pick-menu" onMouseLeave={() => setPickOpen(false)}>
              {candidates.length === 0 ? (
                <div className="rv-pick-empty">Share the doc to add reviewers</div>
              ) : (
                candidates.map((m) => (
                  <button
                    key={m.user.id}
                    disabled={busy}
                    onClick={() => {
                      void addReviewer(m.user.id)
                      setPickOpen(false)
                    }}
                  >
                    {name(m.user)}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* The current user may act only if they are a required reviewer. */}
      {iAmRequired && (
        <div className="review-actions">
          <button
            className={`rv-btn rv-btn-approve${myState === 'APPROVED' ? ' is-active' : ''}`}
            disabled={busy}
            onClick={() => submit('APPROVED')}
          >
            {myState === 'APPROVED' ? 'Approved' : 'Approve'}
          </button>
          <button
            className={`rv-btn rv-btn-changes${myState === 'CHANGES_REQUESTED' ? ' is-active' : ''}`}
            disabled={busy}
            onClick={() => submit('CHANGES_REQUESTED')}
          >
            {myState === 'CHANGES_REQUESTED' ? 'Changes requested' : 'Request changes'}
          </button>
        </div>
      )}
    </div>
  )
}
