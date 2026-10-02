import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import Toolbar from './Toolbar'
import CommentsPanel from './CommentsPanel'
import { CommentMark } from './CommentMark'
import { docs, comments, type Role } from '../lib/api'
import { accessToken } from '../lib/supabase'
import { makeIdentity, type Identity } from '../lib/identity'
import './Editor.css'

const COLLAB_URL = import.meta.env.VITE_COLLAB_URL ?? 'ws://localhost:4001'

type Status = 'connecting' | 'connected' | 'disconnected'

type Props = {
  docId: string
  initialTitle: string
  role: Role
  currentUserId: string
  onTitleSaved: () => void
}

export default function Editor({ docId, initialTitle, role, currentUserId, onTitleSaved }: Props) {
  const identity = useMemo(makeIdentity, [])
  const [conn, setConn] = useState<{ ydoc: Y.Doc; provider: WebsocketProvider } | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [peers, setPeers] = useState(1)
  const [title, setTitle] = useState(initialTitle)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canEdit = role === 'OWNER' || role === 'EDITOR'

  const [showComments, setShowComments] = useState(false)
  const [commentRefresh, setCommentRefresh] = useState(0)
  // Set by the panel; the editor reads it to scroll to/flash an anchor.
  const [focusAnchor, setFocusAnchor] = useState<string | null>(null)

  useEffect(() => {
    let provider: WebsocketProvider | null = null
    let ydoc: Y.Doc | null = null
    let cancelled = false

    accessToken()
      .then((token) => {
        if (cancelled || !token) {
          if (!token) setStatus('disconnected')
          return
        }
        ydoc = new Y.Doc()
        provider = new WebsocketProvider(COLLAB_URL, docId, ydoc, {
          connect: true,
          params: { token },
        })
        setConn({ ydoc, provider })
        setStatus(provider.wsconnected ? 'connected' : 'connecting')
        provider.on('status', onStatus)
        provider.awareness.on('change', onAwareness)
      })
      .catch(() => setStatus('disconnected'))

    function onStatus({ status }: { status: string }) {
      if (status === 'connected') setStatus('connected')
      else if (status === 'disconnected') setStatus('disconnected')
      else setStatus('connecting')
    }
    function onAwareness() {
      setPeers(provider?.awareness.getStates().size || 1)
    }

    return () => {
      cancelled = true
      if (provider) {
        provider.off('status', onStatus)
        provider.awareness.off('change', onAwareness)
        provider.destroy()
      }
      ydoc?.destroy()
      setConn(null)
    }
  }, [docId])

  useEffect(() => setTitle(initialTitle), [initialTitle, docId])

  function onTitleChange(next: string) {
    if (!canEdit) return
    setTitle(next)
    if (titleTimer.current) clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(async () => {
      await docs.updateTitle(docId, next || 'Untitled document')
      onTitleSaved()
    }, 500)
  }

  return (
    <div className="editor-shell">
      <div className="editor-topbar">
        <input
          className="doc-title-input"
          value={title}
          placeholder="Untitled document"
          onChange={(e) => onTitleChange(e.target.value)}
          readOnly={!canEdit}
          aria-label="Document title"
        />
        <button
          className={`comments-btn${showComments ? ' is-active' : ''}`}
          onClick={() => setShowComments((v) => !v)}
        >
          💬 Comments
        </button>
      </div>

      <div className="editor-with-panel">
        {conn ? (
          <CollabEditor
            docId={docId}
            ydoc={conn.ydoc}
            provider={conn.provider}
            identity={identity}
            editable={canEdit}
            focusAnchor={focusAnchor}
            onThreadCreated={() => {
              setCommentRefresh((k) => k + 1)
              setShowComments(true)
            }}
          />
        ) : (
          <div className="editor-scroll">
            <div className="editor-content" />
          </div>
        )}

        {showComments && (
          <CommentsPanel
            docId={docId}
            canEdit={canEdit}
            currentUserId={currentUserId}
            refreshKey={commentRefresh}
            onFocusAnchor={setFocusAnchor}
            onClose={() => setShowComments(false)}
          />
        )}
      </div>

      <div className="collab-status">
        <span className={`dot dot-${status}`} />
        {status === 'connected' && `Live · ${peers} ${peers === 1 ? 'person' : 'people'} here`}
        {status === 'connecting' && 'Connecting…'}
        {status === 'disconnected' && 'Disconnected — reconnecting…'}
      </div>
    </div>
  )
}

function CollabEditor({
  docId,
  ydoc,
  provider,
  identity,
  editable,
  focusAnchor,
  onThreadCreated,
}: {
  docId: string
  ydoc: Y.Doc
  provider: WebsocketProvider
  identity: Identity
  editable: boolean
  focusAnchor: string | null
  onThreadCreated: () => void
}) {
  // A floating "Comment" button shown over the current text selection.
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null)

  const editor = useEditor({
    // Tiptap v3 defaults to rendering during the first React render, which
    // races the async Yjs sync (content arrives after) and triggers a
    // "setState while rendering" warning + blank content. Defer the first
    // render so Collaboration populates from the synced Y.Doc cleanly.
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      CommentMark,
      Collaboration.configure({ document: ydoc }),
      CollaborationCaret.configure({
        provider,
        user: { name: identity.name, color: identity.color },
      }),
    ],
    onSelectionUpdate: ({ editor }) => {
      if (!editable) return
      const { from, to } = editor.state.selection
      if (from === to) {
        setBubble(null)
        return
      }
      const start = editor.view.coordsAtPos(from)
      const end = editor.view.coordsAtPos(to)
      setBubble({ top: start.top - 42, left: (start.left + end.left) / 2 })
    },
  })

  // Scroll to + briefly flash the anchored span when a thread is clicked.
  useEffect(() => {
    if (!focusAnchor) return
    const el = document.querySelector<HTMLElement>(`[data-comment-id="${focusAnchor}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('comment-mark--flash')
      setTimeout(() => el.classList.remove('comment-mark--flash'), 1200)
    }
  }, [focusAnchor])

  const addComment = useCallback(async () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return
    const quote = editor.state.doc.textBetween(from, to, ' ').slice(0, 80)
    const text = window.prompt('Add a comment:')
    if (!text || !text.trim()) return

    // Create the thread server-side first to get a stable id, then anchor the
    // mark to that id so the DB row and the highlighted span share one key.
    const created = await comments.add(docId, text.trim(), { quote })
    editor.chain().focus().setComment(created.id).run()
    setBubble(null)
    onThreadCreated()
  }, [editor, docId, onThreadCreated])

  return (
    <div className="editor-scroll">
      {bubble && editable && (
        <button
          className="comment-bubble"
          style={{ top: bubble.top, left: bubble.left }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={addComment}
        >
          💬 Comment
        </button>
      )}
      {editable && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className="editor-content" />
    </div>
  )
}
