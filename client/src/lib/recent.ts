// Tracks recently-viewed document ids in localStorage (most-recent first).
// Purely client-local — a lightweight "recent" list, no backend needed.

const KEY = 'dx_recent_docs'
const MAX = 20

export function getRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? (arr.filter((x) => typeof x === 'string') as string[]) : []
  } catch {
    return []
  }
}

export function pushRecent(id: string): void {
  if (!id) return
  try {
    const next = [id, ...getRecentIds().filter((x) => x !== id)].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore quota / disabled storage */
  }
}
