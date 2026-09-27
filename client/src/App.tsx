import Editor from './components/Editor'
import './App.css'

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">DX</span>
          <span className="brand-name">DXEditor</span>
        </div>
        <span className="doc-title">Untitled document</span>
        <span className="phase-tag">Phase 3 · live collab</span>
      </header>
      <main className="app-main">
        <Editor />
      </main>
    </div>
  )
}
