const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export type User = { id: string; email: string; name: string | null }

export type DocMeta = {
  id: string
  title: string
  ownerId: string
  isOwner: boolean
  createdAt: string
  updatedAt: string
}

export type Role = 'OWNER' | 'EDITOR' | 'VIEWER'
export type DocDetail = DocMeta & { role: Role }
export type Share = { id: string; role: 'EDITOR' | 'VIEWER'; user: User }

export type Comment = {
  id: string
  body: string
  anchorId: string | null
  quote: string | null
  parentId: string | null
  resolved: boolean
  createdAt: string
  author: User
}
export type Thread = Comment & { replies: Comment[] }

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status}`
    try {
      msg = (await res.json()).error ?? msg
    } catch {
      /* noop */
    }
    throw new ApiError(res.status, msg)
  }
  return (res.status === 204 ? undefined : res.json()) as Promise<T>
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const opts = (method: string, body?: unknown): RequestInit => ({
  method,
  credentials: 'include', // send/receive the session cookie
  headers: body ? { 'Content-Type': 'application/json' } : undefined,
  body: body ? JSON.stringify(body) : undefined,
})

export const api = {
  // --- auth ---
  register: (email: string, password: string, name?: string) =>
    fetch(`${BASE}/api/auth/register`, opts('POST', { email, password, name })).then(json<User>),
  login: (email: string, password: string) =>
    fetch(`${BASE}/api/auth/login`, opts('POST', { email, password })).then(json<User>),
  logout: () => fetch(`${BASE}/api/auth/logout`, opts('POST')).then(json<void>),
  me: () => fetch(`${BASE}/api/auth/me`, opts('GET')).then(json<User>),
  wsToken: () => fetch(`${BASE}/api/auth/ws-token`, opts('GET')).then(json<{ token: string }>),

  // --- documents ---
  list: () => fetch(`${BASE}/api/documents`, opts('GET')).then(json<DocMeta[]>),
  get: (id: string) => fetch(`${BASE}/api/documents/${id}`, opts('GET')).then(json<DocDetail>),
  create: (title?: string) =>
    fetch(`${BASE}/api/documents`, opts('POST', { title })).then(json<DocDetail>),
  updateTitle: (id: string, title: string) =>
    fetch(`${BASE}/api/documents/${id}`, opts('PUT', { title })).then(json<DocMeta>),
  remove: (id: string) => fetch(`${BASE}/api/documents/${id}`, opts('DELETE')).then(json<void>),

  // --- sharing ---
  listShares: (id: string) =>
    fetch(`${BASE}/api/documents/${id}/shares`, opts('GET')).then(json<Share[]>),
  addShare: (id: string, email: string, role: 'EDITOR' | 'VIEWER') =>
    fetch(`${BASE}/api/documents/${id}/shares`, opts('POST', { email, role })).then(json<Share>),
  removeShare: (id: string, userId: string) =>
    fetch(`${BASE}/api/documents/${id}/shares/${userId}`, opts('DELETE')).then(json<void>),

  // --- comments ---
  listComments: (id: string) =>
    fetch(`${BASE}/api/documents/${id}/comments`, opts('GET')).then(json<Thread[]>),
  addComment: (
    id: string,
    body: string,
    extra?: { anchorId?: string; quote?: string; parentId?: string },
  ) =>
    fetch(`${BASE}/api/documents/${id}/comments`, opts('POST', { body, ...extra })).then(
      json<Comment>,
    ),
  setResolved: (id: string, commentId: string, resolved: boolean) =>
    fetch(`${BASE}/api/documents/${id}/comments/${commentId}`, opts('PATCH', { resolved })).then(
      json<Comment>,
    ),
  removeComment: (id: string, commentId: string) =>
    fetch(`${BASE}/api/documents/${id}/comments/${commentId}`, opts('DELETE')).then(json<void>),
}
