import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import './Mermaid.css'

// One-time mermaid init (manual render, neutral theme).
let inited = false
function ensureInit() {
  if (inited) return
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' })
  inited = true
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaid: {
      /** Insert a mermaid diagram block (optionally seeded with source). */
      insertMermaid: (source?: string) => ReturnType
    }
  }
}

const DEFAULT_SRC = `graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Do a thing]
  B -->|No| D[Do another]`

function MermaidView({ node, updateAttributes, editor }: NodeViewProps) {
  const source: string = node.attrs.source || ''
  const [editing, setEditing] = useState(!source.trim())
  const [draft, setDraft] = useState(source)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const idRef = useRef(`mmd-${Math.random().toString(36).slice(2)}`)
  const canEdit = editor.isEditable

  // Render the diagram whenever the (committed) source changes.
  useEffect(() => {
    let cancelled = false
    if (!source.trim()) { setSvg(''); setError(null); return }
    ensureInit()
    mermaid
      .render(idRef.current, source)
      .then((r) => { if (!cancelled) { setSvg(r.svg); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Invalid mermaid syntax') })
    return () => { cancelled = true }
  }, [source])

  function save() {
    updateAttributes({ source: draft })
    setEditing(false)
  }

  return (
    <NodeViewWrapper className="mermaid-block" contentEditable={false}>
      {editing ? (
        <div className="mermaid-editor">
          <textarea
            className="mermaid-src"
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Mermaid syntax, e.g. graph TD; A-->B"
            rows={Math.max(4, draft.split('\n').length + 1)}
          />
          <div className="mermaid-actions">
            <button className="mmd-btn primary" onClick={save}>Render</button>
            {source.trim() && (
              <button className="mmd-btn" onClick={() => { setDraft(source); setEditing(false) }}>Cancel</button>
            )}
          </div>
        </div>
      ) : (
        <div className="mermaid-preview" onDoubleClick={() => canEdit && setEditing(true)} title={canEdit ? 'Double-click to edit' : ''}>
          {error ? (
            <div className="mermaid-error">⚠ {error}</div>
          ) : (
            <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
          )}
          {canEdit && <button className="mermaid-edit-btn" onClick={() => setEditing(true)}>Edit</button>}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export const MermaidNode = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      source: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-source') || '',
        renderHTML: (attrs) => ({ 'data-source': attrs.source }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView)
  },

  addCommands() {
    return {
      insertMermaid:
        (source?: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { source: source ?? DEFAULT_SRC } }),
    }
  },
})
