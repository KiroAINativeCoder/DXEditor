import { useEffect, useRef, useState, useCallback } from 'react'
import mermaid from 'mermaid'
import './MermaidModal.css'

type Props = {
  svg: string
  source?: string
  onClose: () => void
}

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

export default function MermaidModal({ svg: initialSvg, source, onClose }: Props) {
  const [theme, setTheme] = useState<'light' | 'dark'>(getAppTheme)
  const [currentSvg, setCurrentSvg] = useState<string>(initialSvg)
  const [zoom, setZoom] = useState<number>(100) // Percentage: 50% - 300%
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [copied, setCopied] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)

  // Listen to theme changes while modal is open
  useEffect(() => {
    const onTheme = (e: Event) => {
      const detail = (e as CustomEvent<'light' | 'dark'>).detail
      if (detail) setTheme(detail)
      else setTheme(getAppTheme())
    }
    window.addEventListener('dx:theme-changed', onTheme)
    return () => window.removeEventListener('dx:theme-changed', onTheme)
  }, [])

  // If source is available and theme changes, re-render SVG with current theme
  useEffect(() => {
    if (!source || !source.trim()) return
    let cancelled = false
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
            }
          : undefined,
      })

      const renderId = `mmd-modal-${Math.random().toString(36).slice(2)}-${Date.now()}`
      mermaid
        .render(renderId, source)
        .then((res) => {
          if (!cancelled && res.svg) {
            setCurrentSvg(res.svg)
          }
        })
        .catch(() => {
          // keep existing svg if render fails
        })

      return () => {
        cancelled = true
        const el = document.getElementById(renderId)
        if (el) el.remove()
      }
    } catch {
      // ignore
    }
  }, [source, theme])

  // Escape key closes modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        setZoom((z) => Math.min(300, z + 20))
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        setZoom((z) => Math.max(40, z - 20))
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        setZoom(100)
        setPan({ x: 0, y: 0 })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Wheel handler:
  // Only zoom when Ctrl or Meta (Cmd) is held (or trackpad pinch).
  // Normal wheel scroll pans up/down/left/right so the user can scroll through the diagram without it resizing!
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      // Intentional zoom
      const delta = e.deltaY > 0 ? -10 : 10
      setZoom((z) => Math.min(300, Math.max(40, z + delta)))
    } else {
      // Normal scroll pans smoothly without changing diagram size
      setPan((p) => ({
        x: p.x - (e.shiftKey ? e.deltaY : (e.deltaX || 0)),
        y: p.y - (e.shiftKey ? 0 : e.deltaY),
      }))
    }
  }, [])

  // Drag to pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const resetZoom = () => {
    setZoom(100)
    setPan({ x: 0, y: 0 })
  }

  const fitToScreen = () => {
    setZoom(130)
    setPan({ x: 0, y: 0 })
  }

  const copySvg = async () => {
    try {
      await navigator.clipboard.writeText(currentSvg)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  return (
    <div className="mermaid-modal-backdrop" onClick={onClose}>
      <div
        className="mermaid-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Mermaid Diagram Fullscreen Viewer"
      >
        {/* Top Header */}
        <div className="mermaid-modal-header">
          <div className="mm-header-left">
            <span className="mm-header-icon">📊</span>
            <span className="mm-header-title">Mermaid Diagram Viewer</span>
          </div>

          <div className="mm-header-controls">
            <button
              type="button"
              className="mm-tool-btn"
              onClick={() => setZoom((z) => Math.max(40, z - 20))}
              title="Zoom out (−)"
            >
              −
            </button>
            <button
              type="button"
              className="mm-zoom-pill"
              onClick={resetZoom}
              title="Click to reset to 100%"
            >
              {zoom}%
            </button>
            <button
              type="button"
              className="mm-tool-btn"
              onClick={() => setZoom((z) => Math.min(300, z + 20))}
              title="Zoom in (+)"
            >
              +
            </button>
            <div className="mm-divider" />
            <button
              type="button"
              className="mm-action-btn"
              onClick={fitToScreen}
              title="Fit diagram to viewport"
            >
              ⊡ Fit
            </button>
            <button
              type="button"
              className="mm-action-btn"
              onClick={resetZoom}
              title="Reset zoom & position"
            >
              100%
            </button>
            <button
              type="button"
              className="mm-action-btn"
              onClick={copySvg}
              title="Copy raw SVG to clipboard"
            >
              {copied ? '✓ Copied' : 'Copy SVG'}
            </button>
          </div>

          <div className="mm-header-right">
            <button
              type="button"
              className="mm-close-btn"
              onClick={onClose}
              title="Close fullscreen (Esc)"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Viewport Canvas */}
        <div
          ref={viewportRef}
          className={`mermaid-modal-viewport ${isDragging ? 'is-dragging' : ''}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div
            className="mermaid-modal-canvas"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})`,
              transformOrigin: 'center center',
            }}
          >
            <div
              className="mermaid-modal-svg"
              dangerouslySetInnerHTML={{ __html: currentSvg }}
            />
          </div>
        </div>

        {/* Footer Hint */}
        <div className="mermaid-modal-footer">
          <span>Scroll wheel / trackpad to pan · Ctrl + scroll or + / − buttons to zoom</span>
          <span className="mm-footer-hint">Press Esc to exit</span>
        </div>
      </div>
    </div>
  )
}
