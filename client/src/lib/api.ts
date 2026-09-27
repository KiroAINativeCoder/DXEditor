import type { JSONContent } from '@tiptap/react'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export type DocMeta = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type Doc = DocMeta & { content: JSONContent }

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const api = {
  list: () => fetch(`${BASE}/api/documents`).then(json<DocMeta[]>),

  get: (id: string) => fetch(`${BASE}/api/documents/${id}`).then(json<Doc>),

  create: (title?: string, content?: JSONContent) =>
    fetch(`${BASE}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    }).then(json<Doc>),

  update: (id: string, patch: { title?: string; content?: JSONContent }) =>
    fetch(`${BASE}/api/documents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(json<Doc>),

  remove: (id: string) =>
    fetch(`${BASE}/api/documents/${id}`, { method: 'DELETE' }).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`)
    }),
}
