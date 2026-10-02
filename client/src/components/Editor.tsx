import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlock } from '@tiptap/extension-code-block'
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
import VersionPanel from './VersionPanel'
import Menu from './Menu'
import { CommentMark } from './CommentMark'
import { docs, comments, type Role, type Thread as ThreadT } from '../lib/api'
import { accessToken } from '../lib/supabase'
import { makeIdentity, type Identity } from '../lib/identity'
import './Editor.css'

const COLLAB_URL = import.meta.env.VITE_COLLAB_URL ?? 'ws://localhost:4001'

type Status = 'connecting' | 'connected' | 'disconnected'

// Document font options (Quip-style). The key maps to a CSS class on the
// editor content; the stacks live in Editor.css. Selected from the Format menu.
export type FontKey = 'sans' | 'serif' | 'mono'

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

  // --- Versioning: capture/apply the live Yjs state as a base64 update. ---
  function snapshotUpdate(): string | null {
    if (!conn) return null
    const bytes = Y.encodeStateAsUpdate(conn.ydoc)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  }
  function applyUpdate(base64: string) {
    if (!conn) return
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    // Applying a full prior-state update merges it into the CRDT, which brings
    // the shared doc to include that version's content for all clients.
    Y.applyUpdate(conn.ydoc, bytes)
  }

  const [showComments, setShowComments] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [commentRefresh, setCommentRefresh] = useState(0)
  // Document font family (Quip-style). Persisted per-doc in localStorage; the
  // choice is view-local (not synced to collaborators) for this first version.
  const [font, setFont] = useState<FontKey>(
    () => (localStorage.getItem(`dx_font_${docId}`) as FontKey) || 'sans',
  )
  function changeFont(f: FontKey) {
    setFont(f)
    localStorage.setItem(`dx_font_${docId}`, f)
  }
  // Set by the panel; the editor reads it to scroll to/flash an anchor.
  const [focusAnchor, setFocusAnchor] = useState<string | null>(null)
  // The live Tiptap editor instance, lifted from CollabEditor so the menu bar
  // (Edit/Insert/Format) can drive it.
  const [ed, setEd] = useState<TiptapEditor | null>(null)

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
        <div className="title-block">
          <input
            className="doc-title-input"
            value={title}
            placeholder="Untitled document"
            onChange={(e) => onTitleChange(e.target.value)}
            readOnly={!canEdit}
            aria-label="Document title"
          />
          <div className="doc-menu-row" role="menubar" aria-label="Document menus">
            <Menu
              label="Document"
              items={[
                { label: 'Rename…', disabled: !canEdit, onClick: () => {
                    const n = window.prompt('Rename document', title)
                    if (n && n.trim()) onTitleChange(n.trim())
                  } },
              ]}
            />
            <Menu
              label="Edit"
              items={[
                { label: 'Undo', disabled: !ed?.can().undo(), onClick: () => ed?.chain().focus().undo().run() },
                { label: 'Redo', disabled: !ed?.can().redo(), onClick: () => ed?.chain().focus().redo().run() },
              ]}
            />
            <Menu
              label="View"
              items={[
                { label: 'Comments', checked: showComments, onClick: () => setShowComments((v) => !v) },
                { label: 'Version history', checked: showVersions, onClick: () => setShowVersions((v) => !v) },
              ]}
            />
            <Menu
              label="Insert"
              items={[
                { label: 'Table', disabled: !canEdit, onClick: () => ed?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
                { label: 'Checklist', disabled: !canEdit, onClick: () => ed?.chain().focus().toggleTaskList().run() },
                { label: 'Bullet list', disabled: !canEdit, onClick: () => ed?.chain().focus().toggleBulletList().run() },
                { label: 'Numbered list', disabled: !canEdit, onClick: () => ed?.chain().focus().toggleOrderedList().run() },
                { label: 'Code block', disabled: !canEdit, onClick: () => ed?.chain().focus().toggleCodeBlock().run() },
                { label: 'Divider', disabled: !canEdit, onClick: () => ed?.chain().focus().setHorizontalRule().run() },
              ]}
            />
            <Menu
              label="Format"
              items={[
                { label: 'Bold', disabled: !canEdit, onClick: () => ed?.chain().focus().toggleBold().run() },
                { label: 'Italic', disabled: !canEdit, onClick: () => ed?.chain().focus().toggleItalic().run() },
                { label: 'Underline', disabled: !canEdit, onClick: () => ed?.chain().focus().toggleUnderline().run() },
                { label: 'Strikethrough', disabled: !canEdit, onClick: () => ed?.chain().focus().toggleStrike().run() },
                { separator: true, label: '' },
                { label: 'Font: Sans-serif', checked: font === 'sans', onClick: () => changeFont('sans') },
                { label: 'Font: Serif', checked: font === 'serif', onClick: () => changeFont('serif') },
                { label: 'Font: Monospace', checked: font === 'mono', onClick: () => changeFont('mono') },
              ]}
            />
          </div>
        </div>

        <div className="topbar-right">
          <button
            className={`comments-btn${showVersions ? ' is-active' : ''}`}
            onClick={() => setShowVersions((v) => !v)}
            title="Version history"
          >
            🕑 Versions
          </button>
          <button
            className={`comments-btn${showComments ? ' is-active' : ''}`}
            onClick={() => setShowComments((v) => !v)}
            title="Comments"
          >
            💬 Comments
          </button>
        </div>
      </div>

      <div className="editor-with-panel">
        {conn ? (
          <CollabEditor
            docId={docId}
            ydoc={conn.ydoc}
            provider={conn.provider}
            identity={identity}
            editable={canEdit}
            font={font}
            focusAnchor={focusAnchor}
            onEditorReady={setEd}
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
            onResolvedMark={(commentId, resolved) => {
              // Resolving removes the yellow highlight from the document (the
              // thread stays in the right pane). Reopening leaves it in the
              // pane; the span highlight is not restored.
              if (resolved) ed?.chain().unsetComment(commentId).run()
            }}
            onClose={() => setShowComments(false)}
          />
        )}

        {showVersions && (
          <VersionPanel
            docId={docId}
            canEdit={canEdit}
            snapshot={snapshotUpdate}
            applyUpdate={applyUpdate}
            onClose={() => setShowVersions(false)}
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
  font,
  focusAnchor,
  onThreadCreated,
  onEditorReady,
}: {
  docId: string
  ydoc: Y.Doc
  provider: WebsocketProvider
  identity: Identity
  editable: boolean
  font: FontKey
  focusAnchor: string | null
  onThreadCreated: () => void
  onEditorReady?: (editor: TiptapEditor | null) => void
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
      // Disable StarterKit's codeBlock so we can replace it with one that
      // permits the comment mark (ProseMirror's default code_block sets
      // marks:'' , which silently blocks comment highlights inside it).
      StarterKit.configure({ undoRedo: false, codeBlock: false }),
      CodeBlock.extend({ marks: 'comment' }),
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

  // Report the editor instance up to the parent so the menu bar can drive it.
  useEffect(() => {
    onEditorReady?.(editor)
    return () => onEditorReady?.(null)
  }, [editor, onEditorReady])

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

  // Clicking commented text opens a small popover showing that thread.
  const [popover, setPopover] = useState<
    { top: number; left: number; commentId: string; thread: ThreadT | null } | null
  >(null)
  const [popReply, setPopReply] = useState('')

  const loadPopoverThread = useCallback(
    async (commentId: string) => {
      try {
        const threads = await comments.list(docId)
        const t = threads.find((x) => x.id === commentId) ?? null
        setPopover((p) => (p ? { ...p, thread: t } : p))
      } catch {
        /* ignore */
      }
    },
    [docId],
  )

  useEffect(() => {
    const scroll = document.querySelector('.editor-scroll')
    if (!scroll) return
    const onClick = async (e: Event) => {
      const target = e.target as HTMLElement
      // Ignore clicks inside the popover itself.
      if (target.closest('.comment-popover')) return
      const mark = target.closest<HTMLElement>('[data-comment-id]')
      if (!mark) {
        setPopover(null)
        return
      }
      const commentId = mark.getAttribute('data-comment-id')!
      const rect = mark.getBoundingClientRect()
      const scrollRect = scroll.getBoundingClientRect()
      setPopReply('')
      // Position just below the clicked mark, relative to the scroll container.
      setPopover({
        top: rect.bottom - scrollRect.top + scroll.scrollTop + 6,
        left: rect.left - scrollRect.left + scroll.scrollLeft,
        commentId,
        thread: null,
      })
      // Also surface the thread in the side panel (shows resolved too).
      onThreadCreated()
      loadPopoverThread(commentId)
    }
    scroll.addEventListener('click', onClick)
    return () => scroll.removeEventListener('click', onClick)
  }, [docId, loadPopoverThread, onThreadCreated])

  // Add a reply to the thread shown in the popover. Reopens it if resolved so
  // it reappears in the side panel, then refreshes both views.
  const addPopoverReply = useCallback(async () => {
    if (!popover || !popReply.trim()) return
    const parentId = popover.commentId
    await comments.add(docId, popReply.trim(), { parentId })
    setPopReply('')
    onThreadCreated()
    loadPopoverThread(parentId)
  }, [popover, popReply, docId, onThreadCreated, loadPopoverThread])

  // Archive = resolve (one-way): mark resolved, remove the document highlight.
  // The thread stays in the right pane; there is no reopen.
  const archiveThread = useCallback(async () => {
    if (!popover) return
    const id = popover.commentId
    await comments.setResolved(docId, id, true)
    editor?.chain().unsetComment(id).run()
    onThreadCreated()
    loadPopoverThread(id)
  }, [popover, docId, editor, onThreadCreated, loadPopoverThread])

  // Inline new-comment composer (replaces the native window.prompt), shown in
  // the same white-box style as the thread popover.
  const [composer, setComposer] = useState<
    { top: number; left: number; quote: string; text: string } | null
  >(null)

  const openComposer = useCallback(() => {
    if (!editor || !bubble) return
    const { from, to } = editor.state.selection
    if (from === to) return
    const quote = editor.state.doc.textBetween(from, to, ' ').slice(0, 80)
    // Anchor the composer where the bubble was.
    setComposer({ top: bubble.top + 34, left: bubble.left, quote, text: '' })
    setBubble(null)
  }, [editor, bubble])

  const submitComment = useCallback(async () => {
    if (!editor || !composer || !composer.text.trim()) return
    // Create the thread first to get a stable id, then anchor the mark to it so
    // the DB row and the highlighted span share one key.
    const created = await comments.add(docId, composer.text.trim(), { quote: composer.quote })
    editor.chain().focus().setComment(created.id).run()
    setComposer(null)
    onThreadCreated()
  }, [editor, composer, docId, onThreadCreated])

  return (
    <div className="editor-scroll">
      {bubble && editable && (
        <button
          className="comment-bubble"
          style={{ top: bubble.top, left: bubble.left }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={openComposer}
        >
          💬 Comment
        </button>
      )}
      {composer && editable && (
        <div
          className="comment-popover comment-composer"
          style={{ top: composer.top, left: composer.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="cp-head">
            <div className="cp-head-left" />
            <span className="cp-title">Comments</span>
            <div className="cp-head-right">
              <button className="cp-close-btn" onClick={() => setComposer(null)}>
                Close
              </button>
            </div>
          </div>
          {composer.quote && <div className="cp-quote">“{composer.quote}”</div>}
          <div className="cp-footer">
            <textarea
              className="cp-footer-input"
              autoFocus
              rows={1}
              value={composer.text}
              placeholder="Type a message"
              onChange={(e) => setComposer((c) => (c ? { ...c, text: e.target.value } : c))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submitComment()
                }
                if (e.key === 'Escape') setComposer(null)
              }}
            />
            <button className="cp-send-btn" disabled={!composer.text.trim()} onClick={submitComment}>
              Send
            </button>
          </div>
        </div>
      )}
      {editable && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className={`editor-content font-${font}`} />

      {popover && (
        <div
          className="comment-popover"
          style={{ top: popover.top, left: popover.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="cp-head">
            <div className="cp-head-left">
              {editable && popover.thread && !popover.thread.resolved && (
                <button className="cp-archive-btn" onClick={archiveThread}>
                  Archive
                </button>
              )}
              {popover.thread?.resolved && <span className="cp-archived">Archived</span>}
            </div>
            <span className="cp-title">Comments</span>
            <div className="cp-head-right">
              <button className="cp-close-btn" onClick={() => setPopover(null)}>
                Close
              </button>
            </div>
          </div>
          {!popover.thread ? (
            <div className="comment-popover-empty">Loading…</div>
          ) : (
            <>
              <div className="cp-entries">
                <CommentEntry
                  name={authorLabel(popover.thread.author)}
                  when={popover.thread.created_at}
                  body={popover.thread.body}
                />
                {popover.thread.replies.map((r) => (
                  <CommentEntry
                    key={r.id}
                    name={authorLabel(r.author)}
                    when={r.created_at}
                    body={r.body}
                  />
                ))}
              </div>
              {editable && (
                <div className="cp-footer">
                  <textarea
                    className="cp-footer-input"
                    value={popReply}
                    placeholder="Type a message"
                    rows={1}
                    onChange={(e) => setPopReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        addPopoverReply()
                      }
                    }}
                  />
                  <button
                    className="cp-send-btn"
                    disabled={!popReply.trim()}
                    onClick={addPopoverReply}
                  >
                    Send
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Null-safe author display: the app_user join can be null when RLS hides the
// author's row from the current reader. Never let that crash the render.
function authorLabel(author: { name?: string | null; email?: string | null } | null | undefined) {
  return author?.name || author?.email || 'Unknown user'
}

// Relative time like "7m", "2h", "3d" (falls back to a date for older items).
function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'Now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function initials(name: string) {
  const parts = name.replace(/@.*/, '').trim().split(/[\s.]+/).filter(Boolean)
  if (!parts.length) return name.slice(0, 2).toUpperCase()
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

// Stable-ish color from the name, for the avatar circle.
function avatarColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h} 55% 55%)`
}

function CommentEntry({ name, when, body }: { name: string; when: string; body: string }) {
  return (
    <div className="cp-entry">
      <span className="cp-avatar" style={{ background: avatarColor(name) }}>
        {initials(name)}
      </span>
      <div className="cp-entry-main">
        <div className="cp-entry-head">
          <span className="cp-name">{name}</span>
          <span className="cp-when">· {relTime(when)}</span>
        </div>
        <div className="cp-text">{body}</div>
      </div>
    </div>
  )
}
