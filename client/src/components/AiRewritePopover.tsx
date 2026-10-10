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
  contextBefore?: string
  contextAfter?: string
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
  contextBefore,
  contextAfter,
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
        contextBefore,
        contextAfter,
        customInstruction: promptText || undefined,
      })
      setResult(out)
    } catch (err: unknown) {
      setResult('')
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

  const isQuotaError = Boolean(
    error &&
      (error.toLowerCase().includes('quota') ||
        error.toLowerCase().includes('rate limit') ||
        error.toLowerCase().includes('resource_exhausted') ||
        error.toLowerCase().includes('exceeded your current quota'))
  )

  const canApply = !loading && !error && !!result && !result.startsWith('⚠️')

  return (
    <div
      className="ai-popover-card"
      style={{ top, left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="ai-pop-header">
        <div className="ai-pop-badge">
          {mode === 'sentence'
            ? '✨ Crispify (Sentence)'
            : mode === 'bullet'
            ? '📌 Bulletize (Points)'
            : '📊 Tabularize (Data Table)'}
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
        <button
          type="button"
          className={`ai-switch-btn ${mode === 'table' ? 'active' : ''}`}
          onClick={() => handleModeSwitch('table')}
        >
          📊 Tabularize
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
          placeholder="Optional instruction (e.g. 'under 15 words', 'add Owner column')…"
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
      <div className={`ai-output-box ${loading ? 'is-loading' : ''} ${error ? 'has-error' : ''}`}>
        {loading ? (
          <div className="ai-shimmer-container">
            <div className="ai-shimmer-line" />
            <div className="ai-shimmer-text">Refining with AI…</div>
          </div>
        ) : error ? (
          <div className="ai-error-banner" role="alert">
            <div className="ai-error-banner-header">
              <span className="ai-error-banner-icon">⚠️</span>
              <span className="ai-error-banner-title">
                {isQuotaError ? 'API Quota / Rate Limit Exceeded' : 'AI Service Error'}
              </span>
            </div>
            <div className="ai-error-banner-body">{error}</div>
            <div className="ai-error-banner-hint">
              {isQuotaError
                ? 'Free tier quota exhausted for this model. Switch to another model or provider in Settings.'
                : 'Please check your API key, connection, or switch model in Settings.'}
            </div>
            <div className="ai-error-banner-actions">
              <button
                type="button"
                className="ai-error-action-btn primary"
                onClick={onOpenSettings}
              >
                ⚙️ Switch Model or Key
              </button>
              <button
                type="button"
                className="ai-error-action-btn secondary"
                onClick={handleRegenerate}
              >
                ↻ Retry
              </button>
            </div>
          </div>
        ) : result.startsWith('⚠️') ? (
          <div className="ai-warning-box">
            <div className="ai-warning-text">{result}</div>
            <div className="ai-warning-actions">
              <button
                type="button"
                className="ai-warning-btn"
                onClick={() => handleModeSwitch('sentence')}
              >
                ⚡ Switch to Crisp Sentence
              </button>
              <button
                type="button"
                className="ai-warning-btn"
                onClick={() => handleModeSwitch('bullet')}
              >
                📌 Switch to Bullet Points
              </button>
            </div>
          </div>
        ) : result.includes('<ul') || result.includes('<table') ? (
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
            onClick={() => canApply && onInsertBelow(result, mode)}
            disabled={!canApply}
            title={error ? 'Action disabled: API error occurred' : 'Insert generated version below'}
          >
            ⬇ Insert Below
          </button>
          <button
            type="button"
            className="ai-pop-btn-primary"
            onClick={() => canApply && onReplace(result, mode)}
            disabled={!canApply}
            title={error ? 'Action disabled: API error occurred' : 'Replace selected text on behalf of user'}
          >
            ✓ Replace Selection
          </button>
        </div>
      </div>
    </div>
  )
}
