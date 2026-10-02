import { useEffect, useRef, useState, type ReactNode } from 'react'
import './Menu.css'

export type MenuAction = {
  label: string
  onClick?: () => void
  disabled?: boolean
  checked?: boolean // show a check mark (for toggles / current selection)
  separator?: boolean // render a divider instead of an item
}

/**
 * A single top-bar menu (e.g. "Document") that opens a dropdown of actions on
 * click. Closes on outside-click, Escape, or after an action runs.
 */
export default function Menu({
  label,
  items,
  active,
}: {
  label: ReactNode
  items: MenuAction[]
  active?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu" ref={ref}>
      <button
        className={`menu-trigger${open ? ' is-open' : ''}${active ? ' is-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div className="menu-dropdown" role="menu">
          {items.map((it, i) =>
            it.separator ? (
              <div key={i} className="menu-divider" />
            ) : (
              <button
                key={i}
                role="menuitem"
                className="menu-item"
                disabled={it.disabled}
                onClick={() => {
                  it.onClick?.()
                  setOpen(false)
                }}
              >
                <span className="menu-check">{it.checked ? '✓' : ''}</span>
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
