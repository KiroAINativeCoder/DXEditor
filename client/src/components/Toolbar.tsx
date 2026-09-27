import type { Editor } from '@tiptap/react'
import './Toolbar.css'

type Props = { editor: Editor | null }

/** A formatting button that reflects the editor's active state. */
function Btn({
  label,
  title,
  onClick,
  isActive,
  canRun = true,
}: {
  label: React.ReactNode
  title: string
  onClick: () => void
  isActive?: boolean
  canRun?: boolean
}) {
  return (
    <button
      type="button"
      className={`tb-btn${isActive ? ' is-active' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={isActive}
      disabled={!canRun}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export default function Toolbar({ editor }: Props) {
  if (!editor) return null

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="tb-group">
        <Btn title="Bold (⌘B)" label={<b>B</b>}
          isActive={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()} />
        <Btn title="Italic (⌘I)" label={<i>I</i>}
          isActive={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()} />
        <Btn title="Strikethrough" label={<s>S</s>}
          isActive={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()} />
        <Btn title="Inline code" label={<code>{'<>'}</code>}
          isActive={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()} />
      </div>

      <span className="tb-sep" />

      <div className="tb-group">
        <Btn title="Heading 1" label="H1"
          isActive={editor.isActive('heading', { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <Btn title="Heading 2" label="H2"
          isActive={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <Btn title="Heading 3" label="H3"
          isActive={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <Btn title="Paragraph" label="¶"
          isActive={editor.isActive('paragraph')}
          onClick={() => editor.chain().focus().setParagraph().run()} />
      </div>

      <span className="tb-sep" />

      <div className="tb-group">
        <Btn title="Bullet list" label="• —"
          isActive={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <Btn title="Numbered list" label="1."
          isActive={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <Btn title="Checklist" label="☑"
          isActive={editor.isActive('taskList')}
          onClick={() => editor.chain().focus().toggleTaskList().run()} />
        <Btn title="Blockquote" label="❝"
          isActive={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()} />
        <Btn title="Code block" label="{ }"
          isActive={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
      </div>

      <span className="tb-sep" />

      <div className="tb-group">
        <Btn title="Insert table" label="▦"
          onClick={() =>
            editor.chain().focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          } />
        <Btn title="Horizontal rule" label="―"
          onClick={() => editor.chain().focus().setHorizontalRule().run()} />
      </div>

      <span className="tb-sep" />

      <div className="tb-group">
        <Btn title="Undo (⌘Z)" label="↶"
          canRun={editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()} />
        <Btn title="Redo (⌘⇧Z)" label="↷"
          canRun={editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()} />
      </div>
    </div>
  )
}
