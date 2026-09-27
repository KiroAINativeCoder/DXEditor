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
import { makeIdentity } from '../lib/identity'
import './Editor.css'

const COLLAB_URL = import.meta.env.VITE_COLLAB_URL ?? 'ws://localhost:4001'

type Status = 'connecting' | 'connected' | 'disconnected'

type Props = {
  docId: string
  initialTitle: string
  /** Called after the title is persisted, so the sidebar can refresh. */
  onTitleSaved: () => void
}

export default function Editor({ docId, initialTitle, onTitleSaved }: Props) {
  // Recreate the Y.Doc + provider whenever the open document changes.
  // The room name IS the document id, so each doc is an isolated room.
  const { ydoc, provider, identity } = useMemo(() => {
    const ydoc = new Y.Doc()
    const provider = new WebsocketProvider(COLLAB_URL, docId, ydoc, { connect: true })
    return { ydoc, provider, identity: makeIdentity() }
  }, [docId])

  const [status, setStatus] = useState<Status>('connecting')
  const [peers, setPeers] = useState(1)
  const [title, setTitle] = useState(initialTitle)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor(
    {
      extensions: [
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
    },
    [ydoc, provider],
  )

  useEffect(() => setTitle(initialTitle), [initialTitle, docId])

  useEffect(() => {
    // Seed from the provider's live connection flag so a remount (React
    // StrictMode double-mounts in dev) doesn't start stuck on a stale state.
    setStatus(provider.wsconnected ? 'connected' : 'connecting')

    const onStatus = ({ status }: { status: string }) => {
      // y-websocket emits 'connecting' | 'connected' | 'disconnected'.
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
    }
  }, [provider, ydoc])

  // Debounced title persistence to SQLite (metadata store).
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
      <Toolbar editor={editor} />
      <div className="editor-scroll">
        <EditorContent editor={editor} className="editor-content" />
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
