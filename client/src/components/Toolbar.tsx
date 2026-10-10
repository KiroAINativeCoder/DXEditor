import type { Editor } from '@tiptap/react'
import Select from './Select'
import { type FontKey, FONT_OPTIONS } from './Editor'
import './Toolbar.css'

type Props = {
  editor: Editor | null
  font?: FontKey
  onChangeFont?: (font: FontKey) => void
  onOpenAi?: () => void
  onOpenAiSettings?: () => void
}

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
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

type BlockType = 'paragraph' | 'h1' | 'h2' | 'h3'

const BLOCK_LABELS: Record<BlockType, string> = {
  paragraph: 'Paragraph',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
}

export default function Toolbar({
  editor,
  font,
  onChangeFont,
  onOpenAi,
  onOpenAiSettings,
}: Props) {
  if (!editor) return null

  // Current block type, for the dropdown's displayed value.
  const current: BlockType = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : 'paragraph'

  function setBlock(type: BlockType) {
    const chain = editor!.chain().focus()
    if (type === 'paragraph') chain.setParagraph().run()
    else chain.setHeading({ level: Number(type[1]) as 1 | 2 | 3 }).run()
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {/* Undo / redo */}
      <div className="tb-group">
        <Btn title="Undo (⌘Z)" label="↺" canRun={editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()} />
        <Btn title="Redo (⌘⇧Z)" label="↻" canRun={editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()} />
      </div>

      <span className="tb-sep" />

      {/* Block type dropdown */}
      <Select<BlockType>
        className="tb-block-select-wrapper"
        value={current}
        onChange={setBlock}
        options={(Object.keys(BLOCK_LABELS) as BlockType[]).map((t) => ({
          value: t,
          label: BLOCK_LABELS[t],
        }))}
        size="sm"
        ariaLabel="Paragraph style"
      />

      {/* Font dropdown */}
      {font && onChangeFont && (
        <Select<FontKey>
          className="tb-font-select-wrapper"
          value={font}
          onChange={onChangeFont}
          options={FONT_OPTIONS.map((f) => ({
            value: f.key,
            label: f.label,
          }))}
          size="sm"
          ariaLabel="Font family"
        />
      )}

      <span className="tb-sep" />

      {/* Inline formatting */}
      <div className="tb-group">
        <Btn title="Bold (⌘B)" label={<b>B</b>} isActive={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()} />
        <Btn title="Italic (⌘I)" label={<i>I</i>} isActive={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()} />
        <Btn title="Underline" label={<u>U</u>} isActive={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <Btn title="Strikethrough" label={<s>S</s>} isActive={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()} />
        <Btn title="Inline code" label={<code>{'<>'}</code>} isActive={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()} />
      </div>

      <span className="tb-sep" />

      {/* Insert group */}
      <div className="tb-group tb-insert">
        <span className="tb-insert-label">Insert:</span>
        <Btn title="Checklist" label="☑" isActive={editor.isActive('taskList')}
          onClick={() => editor.chain().focus().toggleTaskList().run()} />
        <Btn title="Bullet list" label="•" isActive={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <Btn title="Numbered list" label="1." isActive={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <Btn title="Blockquote" label="❝" isActive={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()} />
        <Btn title="Code block" label="{ }" isActive={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
        <Btn title="Table" label="▦"
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
        <Btn title="Divider" label="―"
          onClick={() => editor.chain().focus().setHorizontalRule().run()} />
      </div>

      {editor.isActive('table') && (
        <>
          <span className="tb-sep" />
          <div className="tb-group tb-table-controls">
            <span className="tb-insert-label" style={{ fontWeight: 600 }}>Table:</span>
            <Btn title="Add row below" label="+ Row"
              onClick={() => editor.chain().focus().addRowAfter().run()} />
            <Btn title="Delete current row" label="- Row"
              onClick={() => editor.chain().focus().deleteRow().run()} />
            <Btn title="Add column right" label="+ Col"
              onClick={() => editor.chain().focus().addColumnAfter().run()} />
            <Btn title="Delete current column" label="- Col"
              onClick={() => editor.chain().focus().deleteColumn().run()} />
            <Btn title="Delete table" label="🗑"
              onClick={() => editor.chain().focus().deleteTable().run()} />
          </div>
        </>
      )}

      {onOpenAi && (
        <>
          <span className="tb-sep" />
          <div className="tb-group">
            <button
              type="button"
              className="tb-ai-btn"
              title="AI Buddy — rewrite selected text (Crispify or Bulletize)"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onOpenAi}
            >
              AI Buddy
            </button>
            {onOpenAiSettings && (
              <button
                type="button"
                className="tb-btn tb-ai-gear"
                title="AI Provider & Model Settings"
                onMouseDown={(e) => e.preventDefault()}
                onClick={onOpenAiSettings}
              >
                ⚙️
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
