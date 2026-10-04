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
import Image from '@tiptap/extension-image'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import Toolbar from './Toolbar'
import CommentsPanel from './CommentsPanel'
import VersionPanel from './VersionPanel'
import Menu from './Menu'
import { CommentMark } from './CommentMark'
import { MermaidNode } from './Mermaid'
import { docs, comments, images, type Role, type Thread as ThreadT, type DocStatus } from '../lib/api'
import { accessToken } from '../lib/supabase'
import { makeIdentity, type Identity } from '../lib/identity'
import AiSettingsModal from './AiSettingsModal'
import AiRewritePopover from './AiRewritePopover'
import { type AiMode, sanitizeTableHtml } from '../lib/ai'
import ReviewBar from './ReviewBar'
import { statusMeta, DOC_STATUSES } from '../lib/rfc'
import { docToMarkdown, markdownToDoc } from '../lib/markdown'
import './Editor.css'

const COLLAB_URL = import.meta.env.VITE_COLLAB_URL ?? 'ws://localhost:4001'

type Status = 'connecting' | 'connected' | 'disconnected'

// Document font options (Quip-style). The key maps to a CSS class on the
// editor content; the stacks live in Editor.css. Selected from the Format menu or Toolbar.
export type FontKey =
  | 'sans'
  | 'inter'
  | 'jakarta'
  | 'serif'
  | 'merriweather'
  | 'playfair'
  | 'mono'
  | 'fira'
  | 'casual'

export const FONT_OPTIONS: { key: FontKey; label: string }[] = [
  { key: 'sans', label: 'System Sans' },
  { key: 'inter', label: 'Inter' },
  { key: 'jakarta', label: 'Plus Jakarta' },
  { key: 'serif', label: 'Georgia Serif' },
  { key: 'merriweather', label: 'Merriweather' },
  { key: 'playfair', label: 'Playfair Display' },
  { key: 'mono', label: 'SF Mono' },
  { key: 'fira', label: 'Fira Code' },
  { key: 'casual', label: 'Casual Hand' },
]

type Props = {
  docId: string
  initialTitle: string
  initialStatus: DocStatus
  role: Role
  currentUserId: string
  onTitleSaved: () => void
}

export default function Editor({ docId, initialTitle, initialStatus, role, currentUserId, onTitleSaved }: Props) {
  const identity = useMemo(makeIdentity, [])
  const [conn, setConn] = useState<{ ydoc: Y.Doc; provider: WebsocketProvider } | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [peers, setPeers] = useState(1)
  const [title, setTitle] = useState(initialTitle)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canEdit = role === 'OWNER' || role === 'EDITOR'
  // Owner/MANAGER manage the review process (status + mandatory reviewers).
  const canManage = role === 'OWNER' || role === 'MANAGER'

  // Doc lifecycle status. The review UI is active only while IN_REVIEW.
  // Status changes refresh the sidebar via onTitleSaved (generic meta signal).
  const [docStatus, setDocStatus] = useState<DocStatus>(initialStatus)
  const [statusOpen, setStatusOpen] = useState(false)
  async function changeStatus(next: DocStatus) {
    setStatusOpen(false)
    if (next === docStatus) return
    const prev = docStatus
    setDocStatus(next) // optimistic
    try {
      await docs.updateMeta(docId, { status: next })
      onTitleSaved()
      setReviewRefresh((k) => k + 1) // reload the review panel for the new status
    } catch {
      setDocStatus(prev) // revert on failure
    }
  }
  // Bumped to force the review panel to reload reviewers/reviews.
  const [reviewRefresh, setReviewRefresh] = useState(0)

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

    // A Yjs doc is a CRDT: Y.applyUpdate only ADDS state, it can't remove text
    // written after the snapshot — so a naive apply does not truly revert.
    // Proper restore = replace the shared XML fragment's content wholesale.
    // Load the snapshot into a temp doc, then in ONE transaction on the live
    // doc delete every child of the "default" fragment (TipTap's field) and
    // insert deep clones of the snapshot's children. The delete+insert is a
    // real Yjs edit, so it syncs to every client and the editor re-renders.
    const snap = new Y.Doc()
    Y.applyUpdate(snap, bytes)
    const src = snap.getXmlFragment('default')
    const dst = conn.ydoc.getXmlFragment('default')

    conn.ydoc.transact(() => {
      if (dst.length > 0) dst.delete(0, dst.length)
      const clones = src.toArray().map(cloneXml)
      if (clones.length > 0) dst.insert(0, clones)
    })
    snap.destroy()
  }

  const [showComments, setShowComments] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [globalAiSettingsOpen, setGlobalAiSettingsOpen] = useState(false)
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
  // Hidden file input for the Insert → Image menu action.
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  async function insertImageFromPicker(file: File) {
    if (!ed) return
    try {
      const url = await images.upload(docId, file)
      ed.chain().focus().setImage({ src: url }).run()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Image upload failed')
    }
  }

  // --- Phase 4: Markdown round-trip (docs-as-code) ---
  const mdInputRef = useRef<HTMLInputElement | null>(null)

  // Export the current doc to a .md download. Mermaid blocks round-trip as
  // fenced ```mermaid, so the file drops cleanly into a Git repo.
  function exportMarkdown() {
    if (!ed) return
    const md = docToMarkdown(ed.getJSON() as Parameters<typeof docToMarkdown>[0])
    const safe = (title || 'document').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'document'
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safe}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  // Import a .md file, REPLACING the document body. Confirm first because this
  // overwrites the shared Yjs content for every collaborator.
  async function importMarkdownFile(file: File) {
    if (!ed || !canEdit) return
    if (!window.confirm('Replace the entire document with the contents of this Markdown file?')) return
    try {
      const text = await file.text()
      const doc = markdownToDoc(text)
      ed.chain().focus().setContent(doc).run()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not import Markdown')
    }
  }

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

  // Derive the document title from the FIRST SENTENCE of the body (Quip/Notion
  // style). Whenever the editor content changes, take the first non-empty block,
  // trim it to the first sentence (or a sensible length), and use that as the
  // title — persisted with the same debounced save. The title field becomes a
  // read-only reflection of the doc's opening line.
  useEffect(() => {
    if (!ed || !canEdit) return
    const derive = () => {
      // First non-empty top-level block's text.
      let firstLine = ''
      ed.state.doc.descendants((node) => {
        if (firstLine) return false
        if (node.isTextblock) {
          const t = node.textContent.trim()
          if (t) firstLine = t
          return false
        }
        return true
      })
      // CRITICAL: if the doc has no text yet (e.g. the Yjs content hasn't synced
      // on load), do NOT touch the title. Deriving here would persist
      // "Untitled document" over the real stored title before sync completes —
      // which is exactly the "title resets to Untitled after refresh" bug.
      if (!firstLine) return
      // First sentence: cut at . ? ! (keeping it), else cap length.
      let next = firstLine
      const m = firstLine.match(/^.*?[.?!](\s|$)/)
      if (m) next = m[0].trim()
      next = next.slice(0, 120).trim()
      if (next && next !== title) onTitleChange(next)
    }
    // Do NOT derive immediately on mount — the Yjs doc may still be empty before
    // sync. Only react to real content changes (sync + typing).
    ed.on('update', derive)
    return () => {
      ed.off('update', derive)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed, canEdit])

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
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void insertImageFromPicker(f)
          e.target.value = '' // allow re-selecting the same file
        }}
      />
      <input
        ref={mdInputRef}
        type="file"
        accept=".md,.markdown,text/markdown"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void importMarkdownFile(f)
          e.target.value = ''
        }}
      />
      <div className="editor-topbar">
        <div className="title-block">
          <input
            className="doc-title-input"
            value={title}
            placeholder="Untitled document"
            readOnly
            title="The title follows the first line of the document"
            aria-label="Document title (from first line)"
          />
          <div className="doc-menu-row" role="menubar" aria-label="Document menus">
            <Menu
              label="Document"
              items={[
                { label: 'Title follows the first line', disabled: true },
                { separator: true, label: '' },
                { label: 'Export as Markdown…', onClick: exportMarkdown },
                { label: 'Import Markdown…', disabled: !canEdit, onClick: () => mdInputRef.current?.click() },
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
                { label: 'Image…', disabled: !canEdit, onClick: () => imageInputRef.current?.click() },
                { label: 'Mermaid diagram', disabled: !canEdit, onClick: () => ed?.chain().focus().insertMermaid().run() },
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
                ...FONT_OPTIONS.map((f) => ({
                  label: `Font: ${f.label}`,
                  checked: font === f.key,
                  onClick: () => changeFont(f.key),
                })),
              ]}
            />
          </div>
        </div>

        <div className="topbar-right">
          <div className="status-pill-wrap">
            <button
              className="status-pill"
              style={{ ['--pill-color' as string]: statusMeta(docStatus).color }}
              disabled={!canEdit}
              onClick={() => canEdit && setStatusOpen((v) => !v)}
              title={canEdit ? 'Change status' : 'Status'}
            >
              <span className="status-dot" />
              {statusMeta(docStatus).label}
              {canEdit && <span className="status-caret">▾</span>}
            </button>
            {statusOpen && (
              <div className="status-menu" onMouseLeave={() => setStatusOpen(false)}>
                {DOC_STATUSES.map((s) => (
                  <button
                    key={s.value}
                    className={`status-menu-item${s.value === docStatus ? ' is-current' : ''}`}
                    onClick={() => changeStatus(s.value)}
                  >
                    <span className="status-dot" style={{ background: s.color }} />
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Review controls appear ONLY while the doc is in review. */}
          {docStatus === 'IN_REVIEW' && (
            <ReviewBar
              docId={docId}
              currentUserId={currentUserId}
              canManage={canManage}
              refreshKey={reviewRefresh}
              onConsensus={(verdict) => {
                if (!canEdit) return
                // Reconcile status from the mandatory-reviewer consensus:
                //  - all mandatory reviewers approved (none requesting changes)
                //    while IN_REVIEW → ACCEPTED
                //  - any changes requested after ACCEPTED → back to IN_REVIEW
                // Never override a terminal human decision (REJECTED/SUPERSEDED).
                // Read the LIVE status via the functional setter so the value
                // isn't narrowed to 'IN_REVIEW' by the surrounding JSX guard.
                setDocStatus((cur) => {
                  if (verdict === 'approved' && cur === 'IN_REVIEW') void changeStatus('ACCEPTED')
                  else if (verdict === 'changes' && cur === 'ACCEPTED') void changeStatus('IN_REVIEW')
                  return cur
                })
              }}
            />
          )}

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
          <button
            className="comments-btn"
            onClick={() => setGlobalAiSettingsOpen(true)}
            title="AI Model & Key Settings"
            style={{ color: '#7c3aed' }}
          >
            ✨ AI Settings
          </button>
        </div>
      </div>

      <AiSettingsModal
        isOpen={globalAiSettingsOpen}
        onClose={() => setGlobalAiSettingsOpen(false)}
      />

      <div className="editor-with-panel">
        {conn ? (
          <CollabEditor
            docId={docId}
            ydoc={conn.ydoc}
            provider={conn.provider}
            identity={identity}
            editable={canEdit}
            font={font}
            onChangeFont={changeFont}
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
  onChangeFont,
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
  onChangeFont: (font: FontKey) => void
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
      Table.configure({
        resizable: true,
        handleWidth: 7,
        cellMinWidth: 45,
        lastColumnResizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      CommentMark,
      MermaidNode,
      Image.configure({ inline: false, allowBase64: false }),
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
    editorProps: {
      // Paste an image (e.g. a screenshot) → upload to storage, insert the URL.
      handlePaste(_view, event) {
        if (!editable) return false
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        )
        if (files.length === 0) return false
        event.preventDefault()
        files.forEach((file) => void uploadAndInsert(file))
        return true
      },
      // Drag-and-drop image files anywhere in the editor.
      handleDrop(_view, event) {
        if (!editable) return false
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        )
        if (files.length === 0) return false
        event.preventDefault()
        files.forEach((file) => void uploadAndInsert(file))
        return true
      },
    },
  })

  // Optimistic image insert: show a LOCAL preview immediately (so paste/drop
  // feels instant), upload in the background, then swap the temporary blob src
  // for the uploaded public URL. The real URL is what syncs to collaborators
  // and persists; the blob URL is local to this client only.
  const uploadAndInsert = useCallback(
    async (file: File) => {
      if (!editor) return
      const tempSrc = URL.createObjectURL(file)
      // Insert the preview right away at the current selection.
      editor.chain().focus().setImage({ src: tempSrc }).run()

      try {
        const url = await images.upload(docId, file)
        // Find the node still holding the temp src and replace it with the URL.
        let pos: number | null = null
        let attrs: Record<string, unknown> = {}
        editor.state.doc.descendants((node, p) => {
          if (node.type.name === 'image' && node.attrs.src === tempSrc) {
            pos = p
            attrs = node.attrs
            return false
          }
          return true
        })
        if (pos !== null) {
          editor.chain().command(({ tr }) => {
            tr.setNodeMarkup(pos!, undefined, { ...attrs, src: url })
            return true
          }).run()
        }
      } catch (e) {
        // Remove the failed preview node and tell the user.
        let pos: number | null = null
        editor.state.doc.descendants((node, p) => {
          if (node.type.name === 'image' && node.attrs.src === tempSrc) { pos = p; return false }
          return true
        })
        if (pos !== null) {
          editor.chain().command(({ tr }) => { tr.delete(pos!, pos! + 1); return true }).run()
        }
        window.alert(e instanceof Error ? e.message : 'Image upload failed')
      } finally {
        URL.revokeObjectURL(tempSrc)
      }
    },
    [editor, docId],
  )

  // Report the editor instance up to the parent so the menu bar can drive it.
  useEffect(() => {
    onEditorReady?.(editor)
    return () => onEditorReady?.(null)
  }, [editor, onEditorReady])

  // Lightbox: double-clicking an image expands it (single click selects the
  // node via ProseMirror's default behavior).
  const [lightbox, setLightbox] = useState<string | null>(null)
  useEffect(() => {
    const scroll = document.querySelector('.editor-scroll')
    if (!scroll) return
    const onDblClick = (e: Event) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'IMG' && t.closest('.editor-content')) {
        const src = (t as HTMLImageElement).src
        if (src) setLightbox(src)
      }
    }
    scroll.addEventListener('dblclick', onDblClick)
    return () => scroll.removeEventListener('dblclick', onDblClick)
  }, [])

  // Mermaid diagram enlarge: the NodeView dispatches the rendered SVG.
  const [mermaidZoom, setMermaidZoom] = useState<string | null>(null)
  useEffect(() => {
    const onEnlarge = (e: Event) => {
      const svg = (e as CustomEvent<string>).detail
      if (svg) setMermaidZoom(svg)
    }
    window.addEventListener('dx-mermaid-enlarge', onEnlarge)
    return () => window.removeEventListener('dx-mermaid-enlarge', onEnlarge)
  }, [])
  useEffect(() => {
    if (!mermaidZoom) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMermaidZoom(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mermaidZoom])
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLightbox(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightbox])

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

  // Floating AI rewrite popover state
  const [aiPopover, setAiPopover] = useState<{
    top: number
    left: number
    mode: AiMode
    selectedText: string
    contextBefore?: string
    contextAfter?: string
    from: number
    to: number
  } | null>(null)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)

  const openAiPopover = useCallback(
    (mode: AiMode = 'sentence') => {
      if (!editor || !bubble) return
      const { from, to } = editor.state.selection
      if (from === to) return
      const selectedText = editor.state.doc.textBetween(from, to, ' ')
      const docSize = editor.state.doc.content.size
      const contextBefore = editor.state.doc.textBetween(Math.max(0, from - 1000), from, ' ')
      const contextAfter = editor.state.doc.textBetween(to, Math.min(docSize, to + 1000), ' ')
      setAiPopover({
        top: bubble.top + 34,
        left: bubble.left,
        mode,
        selectedText,
        contextBefore,
        contextAfter,
        from,
        to,
      })
      setBubble(null)
    },
    [editor, bubble],
  )

  const triggerAiFromToolbar = useCallback(() => {
    if (!editor) return
    const { from, to } = editor.state.selection
    const docSize = editor.state.doc.content.size
    if (from !== to) {
      const start = editor.view.coordsAtPos(from)
      const end = editor.view.coordsAtPos(to)
      const selectedText = editor.state.doc.textBetween(from, to, ' ')
      const contextBefore = editor.state.doc.textBetween(Math.max(0, from - 1000), from, ' ')
      const contextAfter = editor.state.doc.textBetween(to, Math.min(docSize, to + 1000), ' ')
      setAiPopover({
        top: start.top + 30,
        left: (start.left + end.left) / 2,
        mode: 'sentence',
        selectedText,
        contextBefore,
        contextAfter,
        from,
        to,
      })
    } else {
      const $from = editor.state.selection.$from
      const node = $from.parent
      if (node && node.isTextblock && node.textContent.trim()) {
        const startPos = $from.start()
        const endPos = $from.end()
        const coords = editor.view.coordsAtPos(startPos)
        const contextBefore = editor.state.doc.textBetween(Math.max(0, startPos - 1000), startPos, ' ')
        const contextAfter = editor.state.doc.textBetween(endPos, Math.min(docSize, endPos + 1000), ' ')
        setAiPopover({
          top: coords.top + 30,
          left: coords.left + 140,
          mode: 'sentence',
          selectedText: node.textContent,
          contextBefore,
          contextAfter,
          from: startPos,
          to: endPos,
        })
      }
    }
  }, [editor])

  const handleAiReplace = useCallback(
    (newContent: string, _mode: AiMode) => {
      if (!editor || !aiPopover) return
      const { from, to } = aiPopover
      const contentToInsert = newContent.includes('<table')
        ? sanitizeTableHtml(newContent)
        : newContent
      editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContent(contentToInsert)
        .run()
      setAiPopover(null)
    },
    [editor, aiPopover],
  )

  const handleAiInsertBelow = useCallback(
    (newContent: string, _mode: AiMode) => {
      if (!editor || !aiPopover) return
      const { to } = aiPopover
      const contentToInsert = newContent.includes('<table')
        ? sanitizeTableHtml(newContent)
        : newContent
      editor
        .chain()
        .focus()
        .setTextSelection(to)
        .insertContent('<p></p>')
        .insertContent(contentToInsert)
        .run()
      setAiPopover(null)
    },
    [editor, aiPopover],
  )

  return (
    <div className="editor-scroll">
      {bubble && editable && !aiPopover && (
        <div
          className="ai-floating-bubble-bar"
          style={{ top: bubble.top, left: bubble.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="ai-bubble-btn ai-bubble-btn--glow"
            onClick={() => openAiPopover('sentence')}
            title="Polish with AI"
          >
            ✨ AI Polish
          </button>
          <div className="ai-bubble-divider" />
          <button
            type="button"
            className="ai-bubble-btn"
            onClick={() => openAiPopover('sentence')}
            title="Crispify into concise sentence(s)"
          >
            ⚡ Crispify
          </button>
          <button
            type="button"
            className="ai-bubble-btn"
            onClick={() => openAiPopover('bullet')}
            title="Convert into bullet points"
          >
            📌 Bulletize
          </button>
          <button
            type="button"
            className="ai-bubble-btn"
            onClick={() => openAiPopover('table')}
            title="Auto-tabularize data points into rows & columns"
          >
            📊 Tabularize
          </button>
          <div className="ai-bubble-divider" />
          <button
            type="button"
            className="ai-bubble-btn"
            onClick={openComposer}
            title="Add a comment"
          >
            💬 Comment
          </button>
        </div>
      )}

      {aiPopover && (
        <AiRewritePopover
          top={aiPopover.top}
          left={aiPopover.left}
          initialMode={aiPopover.mode}
          selectedText={aiPopover.selectedText}
          contextBefore={aiPopover.contextBefore}
          contextAfter={aiPopover.contextAfter}
          onReplace={handleAiReplace}
          onInsertBelow={handleAiInsertBelow}
          onClose={() => setAiPopover(null)}
          onOpenSettings={() => setAiSettingsOpen(true)}
        />
      )}

      <AiSettingsModal
        isOpen={aiSettingsOpen}
        onClose={() => setAiSettingsOpen(false)}
      />

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
      {editable && (
        <Toolbar
          editor={editor}
          font={font}
          onChangeFont={onChangeFont}
          onOpenAi={triggerAiFromToolbar}
          onOpenAiSettings={() => setAiSettingsOpen(true)}
        />
      )}
      <EditorContent editor={editor} className={`editor-content font-${font}`} />

      {lightbox && (
        <div className="img-lightbox" onClick={() => setLightbox(null)}>
          <button className="img-lightbox-close" onClick={() => setLightbox(null)} aria-label="Close">
            ✕
          </button>
          <img src={lightbox} alt="" className="img-lightbox-img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {mermaidZoom && (
        <div className="img-lightbox" onClick={() => setMermaidZoom(null)}>
          <button className="img-lightbox-close" onClick={() => setMermaidZoom(null)} aria-label="Close">
            ✕
          </button>
          <div
            className="mermaid-zoom-svg"
            onClick={(e) => e.stopPropagation()}
            dangerouslySetInnerHTML={{ __html: mermaidZoom }}
          />
        </div>
      )}

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

// Deep-clone a Yjs XML node so it can be inserted into a DIFFERENT Y.Doc. A
// Yjs type is bound to its own doc, so the snapshot's nodes must be copied
// (not moved) into the live fragment. Handles element and text (with inline
// formatting deltas) — the set TipTap/ProseMirror produces (never XmlHook).
function cloneXml(node: Y.XmlElement | Y.XmlText | Y.XmlHook): Y.XmlElement | Y.XmlText {
  if (node instanceof Y.XmlElement) {
    const el = new Y.XmlElement(node.nodeName)
    const attrs = node.getAttributes()
    for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k] as string)
    const children = node.toArray().map(cloneXml)
    if (children.length > 0) el.insert(0, children)
    return el
  }
  // Text node (also the fallback) — toDelta preserves text + formatting.
  const t = new Y.XmlText()
  t.applyDelta((node as Y.XmlText).toDelta())
  return t
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
