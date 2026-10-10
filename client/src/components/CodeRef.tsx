import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useState } from 'react'
import { parseBlobUrl, fetchCodeRef, permalink, langFromPath, type CodeRefAttrs } from '../lib/coderef'
import './CodeRef.css'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    codeRef: {
      /** Insert a code reference from a pasted GitHub blob URL. */
      insertCodeRef: (url?: string) => ReturnType
    }
  }
}

function shortSha(sha: string) {
  return /^[0-9a-f]{7,}$/i.test(sha) ? sha.slice(0, 7) : sha
}

function CodeRefView({ node, updateAttributes, editor }: NodeViewProps) {
  const a = node.attrs as unknown as CodeRefAttrs
  const canEdit = editor.isEditable
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const empty = !a.owner
  const [url, setUrl] = useState('')

  // Load (or re-pin) from a blob URL / the current ref.
  async function load(fromUrl?: string) {
    setBusy(true)
    setErr(null)
    try {
      const parsed = fromUrl
        ? parseBlobUrl(fromUrl)
        : { owner: a.owner, repo: a.repo, ref: a.ref, path: a.path, startLine: a.startLine, endLine: a.endLine }
      if (!parsed) throw new Error('Not a GitHub blob URL (…/blob/<ref>/<path>#L10-L25)')
      const next = await fetchCodeRef(parsed)
      updateAttributes(next as unknown as Record<string, unknown>)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load code reference')
    } finally {
      setBusy(false)
    }
  }

  if (empty) {
    return (
      <NodeViewWrapper className="coderef-block" contentEditable={false}>
        <div className="coderef-empty">
          <input
            className="coderef-url"
            placeholder="Paste a GitHub file URL  (…/blob/<ref>/<path>#L10-L25)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void load(url) }}
            autoFocus
          />
          <button className="coderef-btn primary" disabled={busy || !url.trim()} onClick={() => void load(url)}>
            {busy ? 'Loading…' : 'Embed'}
          </button>
          {err && <div className="coderef-error">⚠ {err}</div>}
        </div>
      </NodeViewWrapper>
    )
  }

  const lineLabel =
    a.startLine == null ? '' : a.endLine && a.endLine !== a.startLine ? `L${a.startLine}-${a.endLine}` : `L${a.startLine}`

  return (
    <NodeViewWrapper className="coderef-block" contentEditable={false}>
      <div className="coderef-card">
        <div className="coderef-head">
          <a className="coderef-path" href={permalink(a)} target="_blank" rel="noreferrer" title="Open on GitHub">
            {a.owner}/{a.repo} · {a.path} {lineLabel && <span className="coderef-lines">{lineLabel}</span>}
          </a>
          <span className="coderef-sha" title={a.resolvedSha}>@{shortSha(a.resolvedSha || a.ref)}</span>
          {canEdit && (
            <button className="coderef-refresh" disabled={busy} onClick={() => void load()} title="Re-pin to the latest commit">
              {busy ? '…' : '⟳'}
            </button>
          )}
        </div>
        {err && <div className="coderef-error">⚠ {err}</div>}
        <pre className={`coderef-code language-${langFromPath(a.path)}`}>
          <code>{a.snippet}</code>
        </pre>
      </div>
    </NodeViewWrapper>
  )
}

export const CodeRef = Node.create({
  name: 'codeRef',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    const attr = (name: string, def: unknown = '') => ({
      [name]: {
        default: def,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute(`data-${name.toLowerCase()}`)
          return v == null ? def : /^(start|end)Line$/i.test(name) ? (v === '' ? null : Number(v)) : v
        },
        renderHTML: (attrs: Record<string, unknown>) => ({ [`data-${name.toLowerCase()}`]: String(attrs[name] ?? '') }),
      },
    })
    return {
      ...attr('owner'),
      ...attr('repo'),
      ...attr('ref'),
      ...attr('path'),
      ...attr('startLine', null),
      ...attr('endLine', null),
      ...attr('snippet'),
      ...attr('resolvedSha'),
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="coderef"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'coderef' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeRefView)
  },

  addCommands() {
    return {
      insertCodeRef:
        (url?: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: url ? parseBlobUrl(url) ?? {} : {},
          }),
    }
  },
})
