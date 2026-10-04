// Phase 4 — Markdown round-trip (docs-as-code).
//
// Zero-dependency serializer/parser over Tiptap/ProseMirror JSON, scoped to the
// exact node + mark set DXEditor uses. We DON'T use tiptap-markdown/remark: they
// add a dependency and don't know about our custom nodes (mermaid, comment mark,
// task lists). The goal that matters most — a design doc round-tripping to a Git
// repo — needs mermaid preserved as a fenced ```mermaid block, which this does.
//
// Lossy by design for things Markdown has no syntax for: the `comment` mark is
// dropped on export (its text survives), and images export as standard
// ![](url). Everything structural (headings, lists, task lists, tables, code,
// blockquote, hr, mermaid, bold/italic/strike/code/link) round-trips.

type PMNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

// --------------------------------------------------------------- SERIALIZE

export function docToMarkdown(doc: PMNode): string {
  if (!doc?.content) return ''
  return doc.content.map(block).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

function block(n: PMNode): string {
  switch (n.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1)))
      return '#'.repeat(level) + ' ' + inline(n.content)
    }
    case 'paragraph':
      return inline(n.content)
    case 'bulletList':
      return list(n, false)
    case 'orderedList':
      return list(n, true)
    case 'taskList':
      return taskList(n)
    case 'blockquote':
      return (n.content ?? [])
        .map(block)
        .join('\n\n')
        .split('\n')
        .map((l) => '> ' + l)
        .join('\n')
    case 'codeBlock': {
      const lang = (n.attrs?.language as string) || ''
      const code = (n.content ?? []).map((c) => c.text ?? '').join('')
      return '```' + lang + '\n' + code + '\n```'
    }
    case 'mermaid':
      // The flagship round-trip: fenced ```mermaid carrying the diagram source.
      return '```mermaid\n' + ((n.attrs?.source as string) || '').trim() + '\n```'
    case 'image':
      return `![${(n.attrs?.alt as string) || ''}](${(n.attrs?.src as string) || ''})`
    case 'horizontalRule':
      return '---'
    case 'table':
      return table(n)
    default:
      // Unknown block: fall back to its inline text so nothing is silently lost.
      return inline(n.content)
  }
}

function list(n: PMNode, ordered: boolean, depth = 0): string {
  const items = n.content ?? []
  return items
    .map((li, i) => {
      const marker = ordered ? `${i + 1}.` : '-'
      const inner = (li.content ?? [])
        .map((child) =>
          child.type === 'bulletList' || child.type === 'orderedList'
            ? list(child, child.type === 'orderedList', depth + 1)
            : block(child),
        )
        .join('\n')
      // Indent continuation + nested lines under the marker.
      const [first, ...rest] = inner.split('\n')
      const pad = '  '.repeat(depth)
      const restPad = rest.map((l) => (l ? pad + '  ' + l : l)).join('\n')
      return pad + `${marker} ${first}` + (rest.length ? '\n' + restPad : '')
    })
    .join('\n')
}

function taskList(n: PMNode): string {
  return (n.content ?? [])
    .map((item) => {
      const checked = item.attrs?.checked ? 'x' : ' '
      const body = (item.content ?? []).map((c) => (c.type === 'paragraph' ? inline(c.content) : block(c))).join(' ')
      return `- [${checked}] ${body}`
    })
    .join('\n')
}

function table(n: PMNode): string {
  const rows = n.content ?? []
  if (rows.length === 0) return ''
  const cells = (row: PMNode) =>
    (row.content ?? []).map((c) => inline((c.content ?? [])[0]?.content).replace(/\|/g, '\\|') || ' ')
  const header = cells(rows[0])
  const sep = header.map(() => '---')
  const bodyRows = rows.slice(1).map(cells)
  const line = (cs: string[]) => '| ' + cs.join(' | ') + ' |'
  return [line(header), line(sep), ...bodyRows.map(line)].join('\n')
}

function inline(content?: PMNode[]): string {
  if (!content) return ''
  return content
    .map((node) => {
      if (node.type === 'hardBreak') return '  \n'
      if (node.type !== 'text') return inline(node.content)
      let t = node.text ?? ''
      for (const m of node.marks ?? []) {
        switch (m.type) {
          case 'bold': t = `**${t}**`; break
          case 'italic': t = `*${t}*`; break
          case 'strike': t = `~~${t}~~`; break
          case 'code': t = '`' + t + '`'; break
          case 'link': t = `[${t}](${(m.attrs?.href as string) || ''})`; break
          // 'comment' and 'underline' have no Markdown form — text passes through.
        }
      }
      return t
    })
    .join('')
}

// --------------------------------------------------------------- PARSE
// Markdown -> Tiptap JSON. Deliberately a PRAGMATIC subset (headings, lists,
// task lists, blockquote, fenced code incl. ```mermaid, hr, images, and inline
// bold/italic/strike/code/link). Good enough to import a doc authored elsewhere;
// anything unrecognized becomes a paragraph so content is never dropped.

export function markdownToDoc(md: string): PMNode {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const content: PMNode[] = []
  let i = 0

  const flushPara = (buf: string[]) => {
    const text = buf.join('\n').trim()
    if (text) content.push({ type: 'paragraph', content: parseInline(text) })
    buf.length = 0
  }

  const para: string[] = []
  while (i < lines.length) {
    const line = lines[i]

    // Fenced code / mermaid
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      flushPara(para)
      const lang = fence[1]
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++])
      i++ // closing fence
      if (lang === 'mermaid') content.push({ type: 'mermaid', attrs: { source: body.join('\n') } })
      else content.push({ type: 'codeBlock', attrs: { language: lang || null }, content: [{ type: 'text', text: body.join('\n') }] })
      continue
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) { flushPara(para); content.push({ type: 'heading', attrs: { level: h[1].length }, content: parseInline(h[2]) }); i++; continue }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(para); content.push({ type: 'horizontalRule' }); i++; continue }

    // Task list / bullet / ordered — gather the contiguous block
    if (/^\s*- \[[ xX]\]\s+/.test(line)) { flushPara(para); const [node, ni] = gatherTaskList(lines, i); content.push(node); i = ni; continue }
    if (/^\s*[-*]\s+/.test(line)) { flushPara(para); const [node, ni] = gatherList(lines, i, false); content.push(node); i = ni; continue }
    if (/^\s*\d+\.\s+/.test(line)) { flushPara(para); const [node, ni] = gatherList(lines, i, true); content.push(node); i = ni; continue }

    // Blockquote
    if (/^>\s?/.test(line)) {
      flushPara(para)
      const bq: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) bq.push(lines[i++].replace(/^>\s?/, ''))
      content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: parseInline(bq.join('\n').trim()) }] })
      continue
    }

    // Standalone image line
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)
    if (img) { flushPara(para); content.push({ type: 'image', attrs: { alt: img[1], src: img[2] } }); i++; continue }

    // Blank line ends a paragraph
    if (line.trim() === '') { flushPara(para); i++; continue }

    para.push(line); i++
  }
  flushPara(para)
  if (content.length === 0) content.push({ type: 'paragraph' })
  return { type: 'doc', content }
}

function gatherTaskList(lines: string[], start: number): [PMNode, number] {
  const items: PMNode[] = []
  let i = start
  while (i < lines.length) {
    const m = lines[i].match(/^\s*- \[([ xX])\]\s+(.*)$/)
    if (!m) break
    items.push({ type: 'taskItem', attrs: { checked: m[1].toLowerCase() === 'x' }, content: [{ type: 'paragraph', content: parseInline(m[2]) }] })
    i++
  }
  return [{ type: 'taskList', content: items }, i]
}

function gatherList(lines: string[], start: number, ordered: boolean): [PMNode, number] {
  const items: PMNode[] = []
  const re = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*]\s+(.*)$/
  let i = start
  while (i < lines.length) {
    const m = lines[i].match(re)
    if (!m) break
    items.push({ type: 'listItem', content: [{ type: 'paragraph', content: parseInline(m[1]) }] })
    i++
  }
  return [{ type: ordered ? 'orderedList' : 'bulletList', content: items }, i]
}

// Inline parse: a small tokenizer for the common marks. Order matters (code
// first so its contents aren't re-parsed; then links; then emphasis).
function parseInline(text: string): PMNode[] {
  if (!text) return []
  const out: PMNode[] = []
  // Split on the first recognized token, recurse on the remainder.
  const patterns: { re: RegExp; make: (m: RegExpMatchArray) => PMNode }[] = [
    { re: /`([^`]+)`/, make: (m) => ({ type: 'text', text: m[1], marks: [{ type: 'code' }] }) },
    { re: /\[([^\]]+)\]\(([^)]+)\)/, make: (m) => ({ type: 'text', text: m[1], marks: [{ type: 'link', attrs: { href: m[2] } }] }) },
    { re: /\*\*([^*]+)\*\*/, make: (m) => ({ type: 'text', text: m[1], marks: [{ type: 'bold' }] }) },
    { re: /~~([^~]+)~~/, make: (m) => ({ type: 'text', text: m[1], marks: [{ type: 'strike' }] }) },
    { re: /\*([^*]+)\*/, make: (m) => ({ type: 'text', text: m[1], marks: [{ type: 'italic' }] }) },
  ]
  let best: { idx: number; len: number; node: PMNode } | null = null
  for (const p of patterns) {
    const m = text.match(p.re)
    if (m && m.index !== undefined && (best === null || m.index < best.idx)) {
      best = { idx: m.index, len: m[0].length, node: p.make(m) }
    }
  }
  if (!best) return [{ type: 'text', text }]
  if (best.idx > 0) out.push({ type: 'text', text: text.slice(0, best.idx) })
  out.push(best.node)
  out.push(...parseInline(text.slice(best.idx + best.len)))
  return out
}
