import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useState } from 'react'
import mermaid from 'mermaid'
import './Mermaid.css'

export type MermaidSize = 'small' | 'medium' | 'large' | 'full'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaid: {
      /** Insert a mermaid diagram block (optionally seeded with source and size). */
      insertMermaid: (source?: string, size?: MermaidSize) => ReturnType
    }
  }
}

const DEFAULT_SRC = `graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Do a thing]
  B -->|No| D[Do another]`

function getAppTheme(): 'light' | 'dark' {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'dark') return 'dark'
    if (attr === 'light') return 'light'
    const stored = localStorage.getItem('dx_theme')
    if (stored === 'dark') return 'dark'
  }
  return 'light'
}

function MermaidView({ node, updateAttributes, editor }: NodeViewProps) {
  const source: string = node.attrs.source || ''
  const size: MermaidSize = node.attrs.size || 'medium'
  const [editing, setEditing] = useState(!source.trim())
  const [draft, setDraft] = useState(source)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(getAppTheme)
  const canEdit = editor.isEditable

  // Watch for theme toggles to immediately re-render diagram with matching theme
  useEffect(() => {
    const onThemeChange = (e: Event) => {
      const detail = (e as CustomEvent<'light' | 'dark'>).detail
      if (detail) setTheme(detail)
      else setTheme(getAppTheme())
    }
    window.addEventListener('dx:theme-changed', onThemeChange)

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-theme') {
          setTheme(getAppTheme())
        }
      }
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    return () => {
      window.removeEventListener('dx:theme-changed', onThemeChange)
      observer.disconnect()
    }
  }, [])

  // Render the diagram whenever source or theme changes
  useEffect(() => {
    let cancelled = false
    if (!source.trim()) {
      setSvg('')
      setError(null)
      return
    }

    const isDark = theme === 'dark'
    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'neutral',
        securityLevel: 'strict',
        fontFamily: 'inherit',
        themeVariables: isDark
          ? {
              darkMode: true,
              background: '#161b22',
              primaryColor: '#1f6feb',
              primaryTextColor: '#f0f6fc',
              primaryBorderColor: '#388bfd',
              lineColor: '#8b949e',
              secondaryColor: '#21262d',
              tertiaryColor: '#161b22',
              mainBkg: '#161b22',
              nodeBorder: '#388bfd',
              clusterBkg: '#21262d',
              clusterBorder: '#30363d',
              defaultLinkColor: '#8b949e',
              titleColor: '#f0f6fc',
              edgeLabelBackground: '#21262d',
              actorBkg: '#161b22',
              actorBorder: '#388bfd',
              actorTextColor: '#f0f6fc',
              signalColor: '#8b949e',
              signalTextColor: '#f0f6fc',
            }
          : undefined,
      })
    } catch {
      // ignore init error
    }

    const renderId = `mmd-${Math.random().toString(36).slice(2)}-${Date.now()}`
    mermaid
      .render(renderId, source)
      .then((r) => {
        if (!cancelled) {
          setSvg(r.svg)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message || 'Invalid mermaid syntax')
        }
      })

    return () => {
      cancelled = true
      const el = document.getElementById(renderId)
      if (el) el.remove()
      const dEl = document.getElementById('d' + renderId)
      if (dEl) dEl.remove()
    }
  }, [source, theme])

  function save() {
    updateAttributes({ source: draft })
    setEditing(false)
  }

  function handleEnlarge() {
    if (!svg) return
    window.dispatchEvent(
      new CustomEvent('dx-mermaid-enlarge', {
        detail: { svg, source },
      }),
    )
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
            <button className="mmd-btn primary" onClick={save}>
              Render
            </button>
            {source.trim() && (
              <button
                className="mmd-btn"
                onClick={() => {
                  setDraft(source)
                  setEditing(false)
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          className={`mermaid-preview size-${size}`}
          onDoubleClick={handleEnlarge}
          title="Double-click to enlarge fullscreen"
        >
          {error ? (
            <div className="mermaid-error">⚠ {error}</div>
          ) : (
            <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
          )}

          {canEdit && (
            <span
              className="mermaid-drag"
              data-drag-handle
              title="Drag to move diagram"
              contentEditable={false}
            >
              ⠿
            </span>
          )}

          {/* Top-right Floating Action Toolbar */}
          <div className="mermaid-top-toolbar">
            {canEdit && (
              <div className="mermaid-size-switcher" title="Diagram display size">
                <span className="mermaid-size-label">Size:</span>
                <button
                  type="button"
                  className={`mermaid-size-btn ${size === 'small' ? 'is-active' : ''}`}
                  onClick={() => updateAttributes({ size: 'small' })}
                  title="Small (compact width)"
                >
                  S
                </button>
                <button
                  type="button"
                  className={`mermaid-size-btn ${size === 'medium' ? 'is-active' : ''}`}
                  onClick={() => updateAttributes({ size: 'medium' })}
                  title="Medium (balanced width)"
                >
                  M
                </button>
                <button
                  type="button"
                  className={`mermaid-size-btn ${size === 'large' ? 'is-active' : ''}`}
                  onClick={() => updateAttributes({ size: 'large' })}
                  title="Large (fit page width)"
                >
                  L
                </button>
                <button
                  type="button"
                  className={`mermaid-size-btn ${size === 'full' ? 'is-active' : ''}`}
                  onClick={() => updateAttributes({ size: 'full' })}
                  title="Full width (expanded)"
                >
                  Full
                </button>
              </div>
            )}

            {svg && (
              <button
                type="button"
                className="mermaid-tool-btn"
                title="Fullscreen view & zoom"
                onClick={handleEnlarge}
              >
                ⤢ Enlarge
              </button>
            )}

            {canEdit && (
              <button
                type="button"
                className="mermaid-tool-btn primary"
                title="Edit diagram syntax"
                onClick={() => setEditing(true)}
              >
                ✎ Edit
              </button>
            )}
          </div>
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
      size: {
        default: 'medium',
        parseHTML: (el) => (el.getAttribute('data-size') as MermaidSize) || 'medium',
        renderHTML: (attrs) => ({ 'data-size': attrs.size || 'medium' }),
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
        (source?: string, size: MermaidSize = 'medium') =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { source: source ?? DEFAULT_SRC, size },
          }),
    }
  },
})
