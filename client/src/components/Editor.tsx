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
import { makeIdentity } from '../lib/identity'
import './Editor.css'

const COLLAB_URL = import.meta.env.VITE_COLLAB_URL ?? 'ws://localhost:4001'
// One shared room for now; Phase 4 will pick this per selected document.
const ROOM = 'welcome-doc'

const SEED = `
  <h1>Welcome to DXEditor</h1>
  <p>This document is <strong>collaborative</strong>. Open it in a second browser
  window and watch edits and cursors sync in real time.</p>
  <ul data-type="taskList">
    <li data-type="taskItem" data-checked="true">Rich-text editor (Phase 1)</li>
    <li data-type="taskItem" data-checked="true">Persistence (Phase 2)</li>
    <li data-type="taskItem" data-checked="true">Real-time collaboration (Phase 3)</li>
  </ul>
`

type Status = 'connecting' | 'connected' | 'disconnected'

export default function Editor() {
  // Create the Y.Doc + provider once for this room.
  const { ydoc, provider, identity } = useMemo(() => {
    const ydoc = new Y.Doc()
    const provider = new WebsocketProvider(COLLAB_URL, ROOM, ydoc, { connect: true })
    return { ydoc, provider, identity: makeIdentity() }
  }, [])

  const [status, setStatus] = useState<Status>('connecting')
  const [peers, setPeers] = useState(1)
  const seededRef = useRef(false)

  const editor = useEditor({
    extensions: [
      // History is provided by the Collaboration extension — disable StarterKit's.
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

  useEffect(() => {
    const onStatus = ({ status }: { status: string }) => {
      setStatus(status === 'connected' ? 'connected' : 'connecting')
    }
    const onAwareness = () => setPeers(provider.awareness.getStates().size || 1)

    provider.on('status', onStatus)
    provider.awareness.on('change', onAwareness)
    provider.on('connection-close', () => setStatus('disconnected'))

    // Seed the shared doc only if it is empty AND we are the first client in,
    // once synced — so we never clobber existing content or race other peers.
    const onSync = (synced: boolean) => {
      if (!synced || seededRef.current || !editor) return
      seededRef.current = true
      const isEmpty = ydoc.getXmlFragment('default').length === 0
      if (isEmpty && provider.awareness.getStates().size <= 1) {
        editor.commands.setContent(SEED)
      }
    }
    provider.on('sync', onSync)

    return () => {
      provider.off('status', onStatus)
      provider.off('sync', onSync)
      provider.awareness.off('change', onAwareness)
    }
  }, [provider, ydoc, editor])

  // Tear down the provider + doc when the component unmounts.
  useEffect(() => {
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
  }, [provider, ydoc])

  return (
    <div className="editor-shell">
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
