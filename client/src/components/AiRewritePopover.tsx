import { useEffect, useState } from 'react'
import {
  type AiMode,
  getAiConfig,
  PROVIDERS,
  transformText,
} from '../lib/ai'
import './AiRewritePopover.css'

type Props = {
  top: number
  left: number
  initialMode: AiMode
  selectedText: string
  onReplace: (newContent: string, mode: AiMode) => void
  onInsertBelow: (newContent: string, mode: AiMode) => void
  onClose: () => void
  onOpenSettings: () => void
}

export default function AiRewritePopover({
  top,
  left,
  initialMode,
  selectedText,
  onReplace,
  onInsertBelow,
  onClose,
  onOpenSettings,
}: Props) {
  const [mode, setMode] = useState<AiMode>(initialMode)
  const [customPrompt, setCustomPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState<string | null>(null)

  const cfg = getAiConfig()
  const providerMeta = PROVIDERS[cfg.provider]
  const modelShort = cfg.model.includes('/') ? cfg.model.split('/')[1] : cfg.model

  const runTransform = async (targetMode: AiMode, promptText?: string) => {
    setLoading(true)
    setError(null)
    try {
      const out = await transformText({
        text: selectedText,
        mode: targetMode,
        customInstruction: promptText || undefined,
      })
      setResult(out)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transformation failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    runTransform(initialMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleModeSwitch = (newMode: AiMode) => {
    if (newMode === mode) return
    setMode(newMode)
    runTransform(newMode, customPrompt)
  }

  const handleRegenerate = () => {
    runTransform(mode, customPrompt)
  }

  return (
    <div
      className="ai-popover-card"
      style={{ top, left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="ai-pop-header">
        <div className="ai-pop-badge">
          ✨ {mode === 'sentence' ? 'Crispify (Sentence)' : 'Bulletize (Points)'}
        </div>
        <div className="ai-pop-model-tag" onClick={onOpenSettings} title="Click to change model/key">
          <span>{providerMeta.name} · {modelShort}</span>
          <span className="ai-pop-gear">⚙️</span>
        </div>
      </div>

      {/* Pill Slider Switch */}
      <div className="ai-pill-switch">
        <button
          type="button"
          className={`ai-switch-btn ${mode === 'sentence' ? 'active' : ''}`}
          onClick={() => handleModeSwitch('sentence')}
        >
          ⚡ Crisp Sentence
        </button>
        <button
          type="button"
          className={`ai-switch-btn ${mode === 'bullet' ? 'active' : ''}`}
          onClick={() => handleModeSwitch('bullet')}
        >
          📌 Bullet Points
        </button>
      </div>

      {/* Quote Preview */}
      <div className="ai-quote-preview">
        "{selectedText.length > 90 ? selectedText.slice(0, 87) + '…' : selectedText}"
      </div>

      {/* Custom Prompt Box */}
      <div className="ai-custom-prompt">
        <input
          type="text"
          className="ai-prompt-input"
          placeholder="Optional instruction (e.g. 'under 15 words', 'more urgent')…"
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRegenerate()
          }}
        />
        <button
          type="button"
          className="ai-regen-btn"
          onClick={handleRegenerate}
          disabled={loading}
        >
          ↻
        </button>
      </div>

      {/* Output Content */}
      <div className={`ai-output-box ${loading ? 'is-loading' : ''}`}>
        {loading ? (
          <div className="ai-shimmer-container">
            <div className="ai-shimmer-line" />
            <div className="ai-shimmer-text">Refining with AI…</div>
          </div>
        ) : error ? (
          <div className="ai-error-text">⚠️ {error}</div>
        ) : mode === 'bullet' && result.includes('<ul') ? (
          <div
            className="ai-rendered-html"
            dangerouslySetInnerHTML={{ __html: result }}
          />
        ) : (
          <div className="ai-rendered-text">{result}</div>
        )}
      </div>

      {/* Popover Actions */}
      <div className="ai-pop-actions">
        <button type="button" className="ai-pop-btn-ghost" onClick={onClose}>
          Discard
        </button>
        <div className="ai-pop-actions-right">
          <button
            type="button"
            className="ai-pop-btn-secondary"
            onClick={() => onInsertBelow(result, mode)}
            disabled={loading || !result}
            title="Insert crispified version below"
          >
            ⬇ Insert Below
          </button>
          <button
            type="button"
            className="ai-pop-btn-primary"
            onClick={() => onReplace(result, mode)}
            disabled={loading || !result}
            title="Replace selected text on behalf of user"
          >
            ✓ Replace Selection
          </button>
        </div>
      </div>
    </div>
  )
}
