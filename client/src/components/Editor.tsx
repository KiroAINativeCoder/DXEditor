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
import './Editor.css'

const CONTENT = `
  <h1>Welcome to DXEditor</h1>
  <p>A Quip-style collaborative document editor. This is <strong>Phase 1</strong>: a
  single-user rich-text surface built on <em>Tiptap</em>.</p>
  <p>Try the toolbar, or type Markdown shortcuts: <code>#</code> for a heading,
  <code>-</code> for a bullet, <code>[]</code> for a checkbox, <code>&gt;</code> for a quote.</p>
  <ul data-type="taskList">
    <li data-type="taskItem" data-checked="true">Scaffold Vite + React + Tiptap</li>
    <li data-type="taskItem" data-checked="false">Add persistence (Phase 2)</li>
    <li data-type="taskItem" data-checked="false">Add real-time collaboration (Phase 3)</li>
  </ul>
`

export default function Editor() {
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
    content: CONTENT,
  })

  return (
    <div className="editor-shell">
      <Toolbar editor={editor} />
      <div className="editor-scroll">
        <EditorContent editor={editor} className="editor-content" />
      </div>
    </div>
  )
}
