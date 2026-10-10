// Phase 5 — live code references.
//
// Parse a GitHub "blob" URL and fetch the referenced lines from the PUBLIC raw
// endpoint. V1 scope: public repos only (no token), pinned to a commit SHA so
// the snapshot is stable. A branch ref is resolved to its current SHA at insert
// time via the commits API, so later pushes don't silently change the snippet.

export type CodeRefAttrs = {
  owner: string
  repo: string
  ref: string // commit SHA (resolved) or branch/tag as given
  path: string
  startLine: number | null
  endLine: number | null
  // Captured display source + the resolved SHA (so the node renders offline).
  snippet: string
  resolvedSha: string
}

const GH_API = 'https://api.github.com'
const GH_RAW = 'https://raw.githubusercontent.com'

// Accepts:
//   https://github.com/<owner>/<repo>/blob/<ref>/<path...>#L10-L25
//   https://github.com/<owner>/<repo>/blob/<ref>/<path...>#L10
// ref may be a branch, tag, or commit SHA. Returns null if it doesn't match.
export function parseBlobUrl(url: string): Omit<CodeRefAttrs, 'snippet' | 'resolvedSha'> | null {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.hostname !== 'github.com') return null
  const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
  if (!m) return null
  const [, owner, repo, ref, path] = m
  let startLine: number | null = null
  let endLine: number | null = null
  const hash = u.hash.match(/^#L(\d+)(?:-L(\d+))?$/)
  if (hash) {
    startLine = Number(hash[1])
    endLine = hash[2] ? Number(hash[2]) : startLine
  }
  return { owner, repo, ref, path, startLine, endLine }
}

// Resolve a branch/tag/sha ref to a concrete commit SHA (so the snapshot is
// pinned). If `ref` already looks like a full SHA, it's returned as-is.
async function resolveSha(owner: string, repo: string, ref: string): Promise<string> {
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, {
    headers: { Accept: 'application/vnd.github.sha' },
  })
  if (!res.ok) {
    // Fall back to the ref as given (raw endpoint also accepts branch names).
    return ref
  }
  return (await res.text()).trim() || ref
}

// Fetch the file and slice the requested line range (1-based, inclusive).
export async function fetchCodeRef(
  parsed: Omit<CodeRefAttrs, 'snippet' | 'resolvedSha'>,
): Promise<CodeRefAttrs> {
  const sha = await resolveSha(parsed.owner, parsed.repo, parsed.ref)
  const rawUrl = `${GH_RAW}/${parsed.owner}/${parsed.repo}/${sha}/${parsed.path}`
  const res = await fetch(rawUrl)
  if (!res.ok) throw new Error(`GitHub fetch failed (${res.status}) for ${parsed.path}`)
  const full = await res.text()
  let snippet = full
  if (parsed.startLine != null) {
    const lines = full.split('\n')
    const a = Math.max(1, parsed.startLine)
    const b = Math.min(lines.length, parsed.endLine ?? parsed.startLine)
    snippet = lines.slice(a - 1, b).join('\n')
  }
  // Guard against pasting a huge whole-file ref with no range.
  if (parsed.startLine == null && snippet.split('\n').length > 200) {
    snippet = snippet.split('\n').slice(0, 200).join('\n') + '\n… (truncated — add #L1-L50 to the URL)'
  }
  return { ...parsed, ref: sha, resolvedSha: sha, snippet }
}

// A clickable permalink to the exact lines at the pinned SHA.
export function permalink(a: CodeRefAttrs): string {
  const base = `https://github.com/${a.owner}/${a.repo}/blob/${a.resolvedSha}/${a.path}`
  if (a.startLine == null) return base
  return a.endLine && a.endLine !== a.startLine
    ? `${base}#L${a.startLine}-L${a.endLine}`
    : `${base}#L${a.startLine}`
}

// Language hint for the code fence / highlighter, from the file extension.
export function langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', py: 'python',
    rs: 'rust', go: 'go', java: 'java', rb: 'ruby', c: 'c', h: 'c', cpp: 'cpp',
    cs: 'csharp', sh: 'bash', sql: 'sql', json: 'json', yml: 'yaml', yaml: 'yaml',
    md: 'markdown', css: 'css', html: 'html',
  }
  return map[ext] ?? ext
}
