import { useEffect, useRef, useState, type ReactNode } from 'react'
import './Select.css'

export type SelectOption<T extends string = string> = {
  value: T
  label: ReactNode
  badge?: string
  icon?: ReactNode
}

type Props<T extends string = string> = {
  value: T
  onChange: (value: T) => void
  options: SelectOption<T>[]
  className?: string
  ariaLabel?: string
  size?: 'sm' | 'md'
}

export default function Select<T extends string = string>({
  value,
  onChange,
  options,
  className = '',
  ariaLabel = 'Select option',
  size = 'md',
}: Props<T>) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div
      className={`custom-select-container ${size} ${open ? 'is-open' : ''} ${className}`}
      ref={containerRef}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span className="custom-select-label">
          {selectedOption?.icon && <span className="select-icon">{selectedOption.icon}</span>}
          <span className="select-text">{selectedOption?.label}</span>
          {selectedOption?.badge && <span className="select-badge">{selectedOption.badge}</span>}
        </span>
        <svg
          className="select-chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {open && (
        <div className="custom-select-menu" role="listbox">
          {options.map((opt) => {
            const isSelected = opt.value === value
            return (
              <button
                type="button"
                key={opt.value}
                className={`custom-select-item ${isSelected ? 'is-selected' : ''}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
              >
                <span className="select-item-content">
                  {opt.icon && <span className="select-icon">{opt.icon}</span>}
                  <span className="select-text">{opt.label}</span>
                  {opt.badge && <span className="select-badge">{opt.badge}</span>}
                </span>
                {isSelected && (
                  <svg
                    className="select-check"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
