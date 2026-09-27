import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import Toolbar from './Toolbar'
import { api, type Doc } from '../lib/api'
import './Editor.css'

const SEED = `
  <h1>Welcome to DXEditor</h1>
  <p>A Quip-style collaborative document editor. This document is now
  <strong>persisted</strong> — your edits autosave to the backend.</p>
  <ul data-type="taskList">
    <li data-type="taskItem" data-checked="true">Rich-text editor (Phase 1)</li>
    <li data-type="taskItem" data-checked="true">Persistence (Phase 2)</li>
    <li data-type="taskItem" data-checked="false">Real-time collaboration (Phase 3)</li>
  </ul>
`

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
const SAVE_DEBOUNCE_MS = 800

export default function Editor() {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Start writing…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: '',
    editable: false, // enabled once a doc is loaded
    onUpdate: ({ editor }) => {
      if (!docRef.current) return
      setSaveState('saving')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        try {
          await api.update(docRef.current!.id, { content: editor.getJSON() })
          setSaveState('saved')
        } catch {
          setSaveState('error')
        }
      }, SAVE_DEBOUNCE_MS)
    },
  })

  // Keep a ref to the current doc so onUpdate (a stable closure) sees it.
  const docRef = useRef<Doc | null>(null)
  docRef.current = doc

  // Bootstrap: load the most recent doc, or create one seeded with SEED.
  useEffect(() => {
    if (!editor) return
    let cancelled = false
    ;(async () => {
      try {
        const list = await api.list()
        const loaded = list.length
          ? await api.get(list[0].id)
          : await api.create('Untitled document', htmlSeedAsJson(editor))
        if (cancelled) return
        setDoc(loaded)
        editor.commands.setContent(loaded.content)
        editor.setEditable(true)
        setSaveState('saved')
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Load failed')
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  if (loadError) {
    return (
      <div className="editor-shell">
        <div className="editor-error">
          Could not reach the API at <code>{import.meta.env.VITE_API_URL ?? 'http://localhost:4000'}</code>.
          <br />
          Start the server: <code>cd server &amp;&amp; npm run dev</code>
          <br />
          <small>({loadError})</small>
        </div>
      </div>
    )
  }

  return (
    <div className="editor-shell">
      <Toolbar editor={editor} />
      <div className="editor-scroll">
        <EditorContent editor={editor} className="editor-content" />
      </div>
      <div className={`save-status save-${saveState}`}>
        {saveState === 'saving' && 'Saving…'}
        {saveState === 'saved' && 'All changes saved'}
        {saveState === 'error' && 'Save failed — retrying on next edit'}
      </div>
    </div>
  )
}

// Render the SEED HTML into a Tiptap JSON doc using the live editor schema.
function htmlSeedAsJson(editor: NonNullable<ReturnType<typeof useEditor>>) {
  editor.commands.setContent(SEED)
  const json = editor.getJSON()
  editor.commands.clearContent()
  return json
}
