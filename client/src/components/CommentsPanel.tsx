import { useEffect, useState } from 'react'
import { comments as commentsApi, type Thread } from '../lib/api'
import './CommentsPanel.css'

type Props = {
  docId: string
  canEdit: boolean
  currentUserId: string
  /** Bumped externally when a new thread is created in the editor. */
  refreshKey: number
  /** Focus the anchored text in the editor when a thread is clicked. */
  onFocusAnchor: (anchorId: string | null) => void
  /** Called after a thread's resolved state changes, so the editor can
   *  add/remove the corresponding highlight. */
  onResolvedMark?: (commentId: string, resolved: boolean) => void
  onClose: () => void
}

function when(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function CommentsPanel({
  docId,
  canEdit,
  currentUserId,
  refreshKey,
  onFocusAnchor,
  onResolvedMark,
  onClose,
}: Props) {
  const [threads, setThreads] = useState<Thread[]>([])
  const [replyFor, setReplyFor] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  // Show resolved by default: resolving removes the document highlight but the
  // thread must remain visible here.
  const [showResolved, setShowResolved] = useState(true)

  async function load() {
    const t = await commentsApi.list(docId)
    setThreads(t)
    // Clear any lingering highlight for threads that are already resolved.
    for (const thread of t) if (thread.resolved) onResolvedMark?.(thread.id, true)
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, refreshKey])

  async function reply(threadId: string) {
    if (!replyText.trim()) return
    await commentsApi.add(docId, replyText, { parentId: threadId })
    setReplyText('')
    setReplyFor(null)
    await load()
  }

  async function remove(commentId: string) {
    await commentsApi.remove(docId, commentId)
    await load()
  }

  const visible = threads.filter((t) => showResolved || !t.resolved)

  return (
    <aside className="comments-panel">
      <div className="comments-head">
        <span className="comments-title">Comments</span>
        <label className="comments-toggle">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Show resolved
        </label>
        <button className="comments-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {visible.length === 0 && (
        <div className="comments-empty">
          No comments yet.{canEdit && ' Select text in the document and click “Comment”.'}
        </div>
      )}

      <ul className="thread-list">
        {visible.map((t) => (
          <li key={t.id} className={`thread${t.resolved ? ' is-resolved' : ''}`}>
            <button className="thread-anchor" onClick={() => onFocusAnchor(t.anchor_id)}>
              {t.quote ? `“${t.quote}”` : 'Comment'}
            </button>

            <Entry name={t.author?.name || t.author?.email || 'Unknown user'} when={when(t.created_at)} body={t.body}
              canDelete={canEdit && (t.author?.id === currentUserId)}
              onDelete={() => remove(t.id)} />

            {t.replies.map((r) => (
              <Entry key={r.id} reply name={r.author?.name || r.author?.email || 'Unknown user'} when={when(r.created_at)}
                body={r.body}
                canDelete={canEdit && (r.author?.id === currentUserId)}
                onDelete={() => remove(r.id)} />
            ))}

            <div className="thread-actions">
              {canEdit && (
                replyFor === t.id ? (
                  <div className="reply-box">
                    <textarea
                      autoFocus
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Reply…"
                    />
                    <div className="reply-buttons">
                      <button className="btn-primary" onClick={() => reply(t.id)}>Reply</button>
                      <button className="btn-ghost" onClick={() => { setReplyFor(null); setReplyText('') }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn-link" onClick={() => setReplyFor(t.id)}>Reply</button>
                )
              )}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function Entry({
  name,
  when,
  body,
  reply,
  canDelete,
  onDelete,
}: {
  name: string
  when: string
  body: string
  reply?: boolean
  canDelete: boolean
  onDelete: () => void
}) {
  return (
    <div className={`entry${reply ? ' is-reply' : ''}`}>
      <div className="entry-head">
        <span className="entry-name">{name}</span>
        <span className="entry-when">{when}</span>
        {canDelete && (
          <button className="entry-del" title="Delete" onClick={onDelete}>✕</button>
        )}
      </div>
      <div className="entry-body">{body}</div>
    </div>
  )
}
