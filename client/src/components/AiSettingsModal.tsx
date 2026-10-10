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

  if (!isOpen) return null

  const handleProviderSelect = (p: AiProvider) => {
    setProvider(p)
    const pCfg = PROVIDERS[p]
    setModel(pCfg.models[0].id)
    const savedKey = localStorage.getItem(`dx_key_${p}`) || ''
    setKey(savedKey)
  }

  const handleSave = () => {
    saveAiConfig(provider, key, model)
    onSaved?.()
    onClose()
  }

  const currentCfg = PROVIDERS[provider]

  return (
    <div className="ai-modal-overlay" onClick={onClose}>
      <div className="ai-modal-window" onClick={(e) => e.stopPropagation()}>
        <div className="ai-modal-header">
          <div className="ai-modal-title">
            <span className="ai-modal-sparkle">✨</span>
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
                  className={`ai-provider-card ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => handleProviderSelect(pKey)}
                >
                  <div className="ai-card-top">
                    <span className="ai-card-name">
                      <span className="ai-card-icon">{p.icon}</span>
                      {p.name}
                    </span>
                    <span
                      className="ai-card-tag"
                      style={{
                        backgroundColor: `${p.tagColor}15`,
                        color: p.tagColor,
                        border: `1px solid ${p.tagColor}30`,
                      }}
                    >
                      {p.tag}
                    </span>
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
                  <span className="ai-chip-badge">{m.badge}</span>
                </button>
              )
            })}
          </div>

          {/* API Key */}
          <div className="ai-field-label" style={{ marginTop: '16px' }}>
            API Key (Optional)
          </div>
          <input
            type="password"
            className="ai-key-input"
            placeholder={currentCfg.placeholder}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <div className="ai-key-hint">
            Stored locally in your browser's <code>localStorage</code>. Leave empty to use{' '}
            <strong>Demo Simulation Mode</strong>.
          </div>
        </div>

        <div className="ai-modal-footer">
          <button className="ai-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="ai-btn-primary" onClick={handleSave}>
            Save & Apply
          </button>
        </div>
      </div>
    </div>
  )
}
