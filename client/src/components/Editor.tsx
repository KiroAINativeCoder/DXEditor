import { useEffect, useMemo, useRef, useState } from 'react'
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
import { api } from '../lib/api'
import { makeIdentity, type Identity } from '../lib/identity'
import './Editor.css'

const COLLAB_URL = import.meta.env.VITE_COLLAB_URL ?? 'ws://localhost:4001'

type Status = 'connecting' | 'connected' | 'disconnected'

type Props = {
  docId: string
  initialTitle: string
  /** Called after the title is persisted, so the sidebar can refresh. */
  onTitleSaved: () => void
}

/**
 * Outer component owns the Y.Doc + provider lifecycle and the title. It mounts
 * the actual editor (CollabEditor) ONLY once the provider exists, so the Tiptap
 * editor is always created with the Collaboration extension present from the
 * start (swapping it in later throws / breaks history). Provider creation lives
 * in an effect, not useMemo, so React StrictMode's dev double-mount can't hand
 * back a provider we already destroyed.
 */
export default function Editor({ docId, initialTitle, onTitleSaved }: Props) {
  const identity = useMemo(makeIdentity, [])
  const [conn, setConn] = useState<{ ydoc: Y.Doc; provider: WebsocketProvider } | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [peers, setPeers] = useState(1)
  const [title, setTitle] = useState(initialTitle)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    const provider = new WebsocketProvider(COLLAB_URL, docId, ydoc, { connect: true })
    setConn({ ydoc, provider })
    setStatus(provider.wsconnected ? 'connected' : 'connecting')

    const onStatus = ({ status }: { status: string }) => {
      if (status === 'connected') setStatus('connected')
      else if (status === 'disconnected') setStatus('disconnected')
      else setStatus('connecting')
    }
    const onAwareness = () => setPeers(provider.awareness.getStates().size || 1)

    provider.on('status', onStatus)
    provider.awareness.on('change', onAwareness)

    return () => {
      provider.off('status', onStatus)
      provider.awareness.off('change', onAwareness)
      provider.destroy()
      ydoc.destroy()
      setConn(null)
    }
  }, [docId])

  useEffect(() => setTitle(initialTitle), [initialTitle, docId])

  function onTitleChange(next: string) {
    setTitle(next)
    if (titleTimer.current) clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(async () => {
      await api.update(docId, { title: next || 'Untitled document' })
      onTitleSaved()
    }, 500)
  }

  return (
    <div className="editor-shell">
      <input
        className="doc-title-input"
        value={title}
        placeholder="Untitled document"
        onChange={(e) => onTitleChange(e.target.value)}
        aria-label="Document title"
      />
      {conn ? (
        <CollabEditor ydoc={conn.ydoc} provider={conn.provider} identity={identity} />
      ) : (
        <div className="editor-scroll">
          <div className="editor-content" />
        </div>
      )}
      <div className="collab-status">
        <span className={`dot dot-${status}`} />
        {status === 'connected' && `Live · ${peers} ${peers === 1 ? 'person' : 'people'} here`}
        {status === 'connecting' && 'Connecting…'}
        {status === 'disconnected' && 'Disconnected — reconnecting…'}
      </div>
    </div>
  )
}

/** Mounts once a live provider exists, so Collaboration is present at creation. */
function CollabEditor({
  ydoc,
  provider,
  identity,
}: {
  ydoc: Y.Doc
  provider: WebsocketProvider
  identity: Identity
}) {
  const editor = useEditor({
    extensions: [
      // Collaboration provides history/undo — disable StarterKit's.
      StarterKit.configure({ undoRedo: false }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Collaboration.configure({ document: ydoc }),
      CollaborationCaret.configure({
        provider,
        user: { name: identity.name, color: identity.color },
      }),
    ],
  })

  return (
    <>
      <Toolbar editor={editor} />
      <div className="editor-scroll">
        <EditorContent editor={editor} className="editor-content" />
      </div>
    </>
  )
}
