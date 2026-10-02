import { supabase, accessToken } from './supabase'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export type User = { id: string; email: string; name: string | null }
export type Role = 'OWNER' | 'EDITOR' | 'MANAGER' | 'VIEWER'

export type DocMeta = {
  id: string
  title: string
  owner_id: string
  isOwner: boolean
  created_at: string
  updated_at: string
}
export type DocDetail = DocMeta & { role: Role }
export type Share = { id: string; role: 'EDITOR' | 'VIEWER' | 'MANAGER'; user: User }
export type Comment = {
  id: string
  body: string
  anchor_id: string | null
  quote: string | null
  parent_id: string | null
  resolved: boolean
  created_at: string
  author: User
}
export type Thread = Comment & { replies: Comment[] }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// ------------------------------------------------------------------- auth
export const auth = {
  // Returns needsConfirmation=true when Supabase created the user but issued no
  // session (email confirmation is on). The name is stashed locally so we can
  // set it on the app_user row on the first confirmed sign-in.
  signUp: async (email: string, password: string, name?: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw new ApiError(400, error.message)
    if (name) localStorage.setItem('dx_pending_name', name)
    const needsConfirmation = !data.session
    if (!needsConfirmation) void sync(name) // best-effort, non-blocking
    return { user: data.user, needsConfirmation }
  },
  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new ApiError(401, error.message)
    const pendingName = localStorage.getItem('dx_pending_name') ?? undefined
    void sync(pendingName).then(() => localStorage.removeItem('dx_pending_name'))
    return data.user
  },
  signOut: () => supabase.auth.signOut(),
  current: async (): Promise<User | null> => {
    const { data } = await supabase.auth.getUser()
    if (!data.user) return null
    return { id: data.user.id, email: data.user.email ?? '', name: null }
  },
}

/**
 * Best-effort update of the app_user display name. The ROW ITSELF is created by
 * a database trigger on auth.users (see supabase/0002_app_user_trigger.sql), so
 * this is purely to set the optional name — it must NEVER throw into the login
 * flow. Any failure (API down, offline) is swallowed.
 */
async function sync(name?: string) {
  try {
    const token = await accessToken()
    if (!token || !name) return
    await fetch(`${BASE}/api/auth/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    })
  } catch {
    /* non-fatal: the DB trigger already provisioned the row */
  }
}

// -------------------------------------------------------------- documents
// All reads/writes go straight to Supabase; RLS filters to owned+shared rows.

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? ''
}

export const docs = {
  list: async (): Promise<DocMeta[]> => {
    const uid = await myId()
    const { data, error } = await supabase
      .from('document')
      .select('id,title,owner_id,created_at,updated_at')
      .order('updated_at', { ascending: false })
    if (error) throw new ApiError(500, error.message)
    return (data ?? []).map((d) => ({ ...d, isOwner: d.owner_id === uid }))
  },

  get: async (id: string): Promise<DocDetail> => {
    const uid = await myId()
    const { data, error } = await supabase
      .from('document')
      .select('id,title,owner_id,created_at,updated_at')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) throw new ApiError(404, 'Document not found')
    let role: Role = data.owner_id === uid ? 'OWNER' : 'VIEWER'
    if (data.owner_id !== uid) {
      const { data: m } = await supabase
        .from('membership')
        .select('role')
        .eq('document_id', id)
        .eq('user_id', uid)
        .maybeSingle()
      if (m) role = m.role as Role
    }
    return { ...data, isOwner: data.owner_id === uid, role }
  },

  create: async (title?: string): Promise<DocDetail> => {
    const uid = await myId()
    // Insert WITHOUT return=representation: an inline INSERT…RETURNING forces a
    // SELECT-policy evaluation on the brand-new row in the same statement, which
    // was failing RLS. A plain insert passes the insert policy cleanly; we then
    // read the row back with a normal select (the SELECT policy permits owned
    // docs), newest-first to grab the one we just made.
    const { error } = await supabase
      .from('document')
      .insert({ title: title?.trim() || 'Untitled document', owner_id: uid })
    if (error) throw new ApiError(403, error.message)

    const { data, error: selErr } = await supabase
      .from('document')
      .select('id,title,owner_id,created_at,updated_at')
      .eq('owner_id', uid)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (selErr || !data) throw new ApiError(500, selErr?.message ?? 'Created but could not load the document')
    return { ...data, isOwner: true, role: 'OWNER' }
  },

  updateTitle: async (id: string, title: string) => {
    const { error } = await supabase.from('document').update({ title }).eq('id', id)
    if (error) throw new ApiError(403, error.message)
  },

  remove: async (id: string) => {
    const { error } = await supabase.from('document').delete().eq('id', id)
    if (error) throw new ApiError(403, error.message)
  },
}

// ---------------------------------------------------------------- sharing
export const shares = {
  list: async (docId: string): Promise<Share[]> => {
    const { data, error } = await supabase
      .from('membership')
      .select('id,role,user:app_user(id,email,name)')
      .eq('document_id', docId)
    if (error) throw new ApiError(403, error.message)
    return (data ?? []) as unknown as Share[]
  },

  add: async (docId: string, email: string, role: Role) => {
    // Resolve the target user id by email (app_user is readable per RLS only
    // for collaborators; sharing with a brand-new email requires that the user
    // has signed up at least once — same constraint as before).
    const { data: target, error: e1 } = await supabase
      .from('app_user')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (e1 || !target) throw new ApiError(404, 'No user with that email')
    const { error } = await supabase
      .from('membership')
      .upsert(
        { document_id: docId, user_id: target.id, role },
        { onConflict: 'document_id,user_id' },
      )
    if (error) throw new ApiError(403, error.message)
  },

  remove: async (docId: string, userId: string) => {
    const { error } = await supabase
      .from('membership')
      .delete()
      .eq('document_id', docId)
      .eq('user_id', userId)
    if (error) throw new ApiError(403, error.message)
  },
}

// --------------------------------------------------------------- comments
export const comments = {
  list: async (docId: string): Promise<Thread[]> => {
    const { data, error } = await supabase
      .from('comment')
      .select('*, author:app_user(id,email,name)')
      .eq('document_id', docId)
      .order('created_at', { ascending: true })
    if (error) throw new ApiError(403, error.message)
    const rows = (data ?? []) as unknown as Comment[]
    const roots = rows.filter((c) => !c.parent_id).map((r) => ({ ...r, replies: [] as Comment[] }))
    const byId = new Map(roots.map((r) => [r.id, r]))
    for (const c of rows) if (c.parent_id && byId.has(c.parent_id)) byId.get(c.parent_id)!.replies.push(c)
    return roots
  },

  add: async (
    docId: string,
    body: string,
    extra?: { anchorId?: string; quote?: string; parentId?: string },
  ): Promise<Comment> => {
    const uid = await myId()
    // Plain insert (no inline RETURNING): an INSERT…RETURNING forces a
    // SELECT-policy evaluation on the new row in the same statement, which RLS
    // rejects. Insert, then read the row back with a normal select.
    const { error } = await supabase.from('comment').insert({
      document_id: docId,
      author_id: uid,
      body,
      anchor_id: extra?.parentId ? null : (extra?.anchorId ?? null),
      quote: extra?.parentId ? null : (extra?.quote ?? null),
      parent_id: extra?.parentId ?? null,
    })
    if (error) throw new ApiError(403, error.message)

    const { data, error: selErr } = await supabase
      .from('comment')
      .select('*, author:app_user(id,email,name)')
      .eq('document_id', docId)
      .eq('author_id', uid)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (selErr || !data) throw new ApiError(500, selErr?.message ?? 'Comment created but could not load it')
    return data as unknown as Comment
  },

  setResolved: async (_docId: string, commentId: string, resolved: boolean) => {
    const { error } = await supabase.from('comment').update({ resolved }).eq('id', commentId)
    if (error) throw new ApiError(403, error.message)
  },

  remove: async (_docId: string, commentId: string) => {
    const { error } = await supabase.from('comment').delete().eq('id', commentId)
    if (error) throw new ApiError(403, error.message)
  },
}
