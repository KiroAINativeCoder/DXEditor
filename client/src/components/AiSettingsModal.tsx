import { useState } from 'react'
import {
  PROVIDERS,
  type AiProvider,
  getAiConfig,
  saveAiConfig,
} from '../lib/ai'
import './AiSettingsModal.css'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

export default function AiSettingsModal({ isOpen, onClose, onSaved }: Props) {
  const current = getAiConfig()
  const [provider, setProvider] = useState<AiProvider>(current.provider)
  const [model, setModel] = useState<string>(current.model)
  const [key, setKey] = useState<string>(
    localStorage.getItem(`dx_key_${current.provider}`) || '',
  )
  const [showKey, setShowKey] = useState(false)

  if (!isOpen) return null

  const handleProviderSelect = (p: AiProvider) => {
    if (PROVIDERS[p].disabled) return
    setProvider(p)
    const pCfg = PROVIDERS[p]
    setModel(pCfg.models[0].id)
    const savedKey = localStorage.getItem(`dx_key_${p}`) || ''
    setKey(savedKey)
  }

  const handleSave = () => {
    if (!key.trim()) return // key is mandatory
    saveAiConfig(provider, key.trim(), model)
    onSaved?.()
    onClose()
  }

  const currentCfg = PROVIDERS[provider]

  return (
    <div className="ai-modal-overlay" onClick={onClose}>
      <div className="ai-modal-window" onClick={(e) => e.stopPropagation()}>
        <div className="ai-modal-header">
          <div className="ai-modal-title">
            AI Provider & Model Settings
          </div>
          <button className="ai-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="ai-modal-body">
          <div className="ai-field-label">Select AI Provider</div>

          {/* 4-Card Provider Selector */}
          <div className="ai-provider-grid">
            {(Object.keys(PROVIDERS) as AiProvider[]).map((pKey) => {
              const p = PROVIDERS[pKey]
              const isSelected = pKey === provider
              return (
                <div
                  key={pKey}
                  className={`ai-provider-card ${isSelected ? 'is-selected' : ''} ${p.disabled ? 'is-disabled' : ''}`}
                  onClick={() => handleProviderSelect(pKey)}
                >
                  <div className="ai-card-top">
                    <span className="ai-card-name">{p.name}</span>
                    <span className="ai-card-tag">{p.tag}</span>
                  </div>
                  <div className="ai-card-desc">{p.hint}</div>
                </div>
              )
            })}
          </div>

          {/* Model Chips Selector */}
          <div className="ai-field-label">Select Model</div>
          <div className="ai-model-chips">
            {currentCfg.models.map((m) => {
              const isSelected = m.id === model
              return (
                <button
                  type="button"
                  key={m.id}
                  className={`ai-model-chip ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => setModel(m.id)}
                >
                  <span className="ai-chip-name">{m.label}</span>
                </button>
              )
            })}
          </div>

          {/* API Key — required */}
          <div className="ai-field-label" style={{ marginTop: '16px' }}>
            API Key <span className="ai-required">(required)</span>
          </div>
          <div className="ai-key-input-wrap">
            <input
              type={showKey ? 'text' : 'password'}
              className="ai-key-input"
              placeholder={currentCfg.placeholder}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              type="button"
              className="ai-key-reveal"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? 'Hide key' : 'Show key'}
              aria-label={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="ai-key-hint">
            {key
              ? 'A saved key is loaded for this provider — click Show to reveal it.'
              : 'Stored locally in your browser\u2019s '}
            {!key && <code>localStorage</code>}
            {!key && '. An API key is required to use the AI features.'}
          </div>
        </div>

        <div className="ai-modal-footer">
          <button className="ai-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="ai-btn-primary" onClick={handleSave} disabled={!key.trim()}>
            Save & Apply
          </button>
        </div>
      </div>
    </div>
  )
}
