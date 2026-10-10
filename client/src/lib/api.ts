import { supabase, accessToken } from './supabase'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export type User = { id: string; email: string; name: string | null }
export type Role = 'OWNER' | 'EDITOR' | 'MANAGER' | 'VIEWER'

// Design-doc review workflow. Every doc has a status lifecycle; the review UI
// is active only while the doc is IN_REVIEW. Mandatory reviewers are named
// (see the `reviewers` module) and chosen from the doc's existing members.
export type DocStatus = 'DRAFT' | 'IN_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED'
export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED'

export type DocMeta = {
  id: string
  title: string
  owner_id: string
  isOwner: boolean
  status: DocStatus
  superseded_by: string | null
  created_at: string
  updated_at: string
}
export type DocDetail = DocMeta & { role: Role }

export type Review = {
  id: string
  document_id: string
  state: ReviewState
  note: string | null
  created_at: string
  reviewer: User
}
// A named mandatory reviewer on a doc.
export type DocReviewer = { id: string; user: User }
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

    // Anti-enumeration: when the email is ALREADY registered, Supabase returns a
    // fake success — data.user is set but data.user.identities is EMPTY and there
    // is no session. Detect that and tell the user to log in, instead of falsely
    // claiming a confirmation email was sent (the old `!data.session` check
    // treated this identically to a genuine new signup).
    const identities = data.user?.identities ?? []
    if (data.user && identities.length === 0) {
      throw new ApiError(409, 'An account with this email already exists. Please log in instead.')
    }

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

/**
 * Ensure the caller's app_user row exists (the FK target for document.owner_id).
 * Normally the auth.users DB trigger creates it, but a brand-new user acting
 * immediately after confirming (before any trigger/sync ran) can hit a FK
 * violation on their first insert. This provisions the row on demand via the
 * server's service-role sync endpoint. Returns true if provisioning succeeded.
 */
async function ensureAppUser(): Promise<boolean> {
  try {
    const token = await accessToken()
    if (!token) return false
    const res = await fetch(`${BASE}/api/auth/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    })
    return res.ok
  } catch {
    return false
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
      .select('id,title,owner_id,status,superseded_by,created_at,updated_at')
      .order('updated_at', { ascending: false })
    if (error) throw new ApiError(500, error.message)
    return (data ?? []).map((d) => ({ ...d, isOwner: d.owner_id === uid }))
  },

  get: async (id: string): Promise<DocDetail> => {
    const uid = await myId()
    const { data, error } = await supabase
      .from('document')
      .select('id,title,owner_id,status,superseded_by,created_at,updated_at')
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
    const row = { title: title?.trim() || 'Untitled document', owner_id: uid }

    // Insert WITHOUT return=representation: an inline INSERT…RETURNING forces a
    // SELECT-policy evaluation on the brand-new row in the same statement, which
    // was failing RLS. A plain insert passes the insert policy cleanly; we then
    // read the row back with a normal select.
    let { error } = await supabase.from('document').insert(row)

    // A brand-new user (e.g. just after confirming their email) may not have an
    // app_user row yet, so owner_id fails the foreign key. Provision it and retry.
    if (error && /foreign key|owner_id_fkey|23503/i.test(error.message)) {
      await ensureAppUser()
      ;({ error } = await supabase.from('document').insert(row))
    }
    if (error) throw new ApiError(403, error.message)

    const { data, error: selErr } = await supabase
      .from('document')
      .select('id,title,owner_id,status,superseded_by,created_at,updated_at')
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

  // Update doc lifecycle metadata (status, supersession). RLS
  // (document_update → can_edit) gates this to owner / EDITOR / MANAGER.
  updateMeta: async (
    id: string,
    patch: { status?: DocStatus; superseded_by?: string | null },
  ) => {
    const { error } = await supabase.from('document').update(patch).eq('id', id)
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
    const token = await accessToken()
    const auth = token ? { Authorization: `Bearer ${token}` } : undefined

    // Resolve the target user by email via the server (service role). A direct
    // client query of app_user can't see users you haven't collaborated with
    // yet (RLS), so the lookup must happen server-side.
    const res = await fetch(`${BASE}/api/users/lookup?email=${encodeURIComponent(email)}`, {
      headers: auth,
    })
    if (res.status === 404) throw new ApiError(404, 'No user with that email')
    if (!res.ok) throw new ApiError(res.status, `Lookup failed (${res.status})`)
    const target = (await res.json()) as { id: string }

    // Create the membership via the server (service role) after it verifies the
    // caller owns/manages the doc. Avoids client-token/RLS timing fragility.
    const shareRes = await fetch(`${BASE}/api/docs/${docId}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ?? {}) },
      body: JSON.stringify({ userId: target.id, role }),
    })
    if (!shareRes.ok) {
      let msg = `Share failed (${shareRes.status})`
      try {
        const body = (await shareRes.json()) as { error?: string }
        if (body.error) msg = body.error
      } catch {
        /* keep default */
      }
      throw new ApiError(shareRes.status, msg)
    }
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
    // Fetch via the server (service role) so author details resolve even for
    // commenters whose app_user row RLS hides from this reader.
    const token = await accessToken()
    const res = await fetch(`${BASE}/api/docs/${docId}/comments`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) throw new ApiError(res.status, `Could not load comments (${res.status})`)
    const rows = (await res.json()) as Comment[]
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

// -------------------------------------------------------------- versions
export type DocVersion = {
  id: string
  label: string | null
  created_at: string
  author?: User | null
}

async function authHeaders(json = false): Promise<Record<string, string>> {
  const token = await accessToken()
  const h: Record<string, string> = {}
  if (token) h.Authorization = `Bearer ${token}`
  if (json) h['Content-Type'] = 'application/json'
  return h
}

export const versions = {
  list: async (docId: string): Promise<DocVersion[]> => {
    const res = await fetch(`${BASE}/api/docs/${docId}/versions`, { headers: await authHeaders() })
    if (!res.ok) throw new ApiError(res.status, `Could not load versions (${res.status})`)
    return (await res.json()) as DocVersion[]
  },

  // `update` is a base64-encoded Y.encodeStateAsUpdate(ydoc).
  create: async (docId: string, update: string, label?: string): Promise<DocVersion> => {
    const res = await fetch(`${BASE}/api/docs/${docId}/versions`, {
      method: 'POST',
      headers: await authHeaders(true),
      body: JSON.stringify({ update, label }),
    })
    if (!res.ok) {
      const msg = await res.json().then((b) => b.error).catch(() => null)
      throw new ApiError(res.status, msg || `Could not save version (${res.status})`)
    }
    return (await res.json()) as DocVersion
  },

  // Returns the base64 Yjs update for preview/restore.
  get: async (docId: string, versionId: string): Promise<{ id: string; label: string | null; created_at: string; update: string }> => {
    const res = await fetch(`${BASE}/api/docs/${docId}/versions/${versionId}`, { headers: await authHeaders() })
    if (!res.ok) throw new ApiError(res.status, `Could not load version (${res.status})`)
    return res.json()
  },

  remove: async (docId: string, versionId: string): Promise<void> => {
    const res = await fetch(`${BASE}/api/docs/${docId}/versions/${versionId}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    })
    if (!res.ok) throw new ApiError(res.status, `Could not delete version (${res.status})`)
  },
}

// ---------------------------------------------------------------- reviews
// PR-style approvals on a doc. Reads go through the server (service role) so a
// reviewer's app_user name resolves even when RLS would hide that row from the
// current reader — the same pattern comments.list uses. Writes go direct to
// Supabase under RLS (a reviewer may only upsert/delete their OWN review).
export const reviews = {
  list: async (docId: string): Promise<Review[]> => {
    const token = await accessToken()
    const res = await fetch(`${BASE}/api/docs/${docId}/reviews`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) throw new ApiError(res.status, `Could not load reviews (${res.status})`)
    return (await res.json()) as Review[]
  },

  // Record (or replace) the caller's review. Plain upsert then select-back to
  // avoid the inline INSERT…RETURNING RLS rejection seen elsewhere.
  submit: async (docId: string, state: ReviewState, note?: string): Promise<void> => {
    const uid = await myId()
    const { error } = await supabase.from('review').upsert(
      {
        document_id: docId,
        reviewer_id: uid,
        state,
        note: note?.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'document_id,reviewer_id' },
    )
    if (error) throw new ApiError(403, error.message)
  },

  withdraw: async (docId: string): Promise<void> => {
    const uid = await myId()
    const { error } = await supabase
      .from('review')
      .delete()
      .eq('document_id', docId)
      .eq('reviewer_id', uid)
    if (error) throw new ApiError(403, error.message)
  },
}

// ------------------------------------------------------ mandatory reviewers
// Named reviewers who must approve before a doc can be ACCEPTED. Chosen from
// the doc's existing members. Managed by owner/MANAGER (doc_reviewer RLS).
export const reviewers = {
  list: async (docId: string): Promise<DocReviewer[]> => {
    const { data, error } = await supabase
      .from('doc_reviewer')
      .select('id,user:app_user(id,email,name)')
      .eq('document_id', docId)
    if (error) throw new ApiError(403, error.message)
    return (data ?? []) as unknown as DocReviewer[]
  },

  add: async (docId: string, userId: string): Promise<void> => {
    const { error } = await supabase
      .from('doc_reviewer')
      .upsert({ document_id: docId, user_id: userId }, { onConflict: 'document_id,user_id' })
    if (error) throw new ApiError(403, error.message)
  },

  remove: async (docId: string, userId: string): Promise<void> => {
    const { error } = await supabase
      .from('doc_reviewer')
      .delete()
      .eq('document_id', docId)
      .eq('user_id', userId)
    if (error) throw new ApiError(403, error.message)
  },
}

// ---------------------------------------------------------------- images
export const images = {
  // Upload an image file to Supabase Storage and return its public URL. The
  // doc only ever stores the URL (not the bytes), keeping the Yjs CRDT small.
  upload: async (docId: string, file: File): Promise<string> => {
    if (!file.type.startsWith('image/')) throw new ApiError(400, 'Not an image file')
    if (file.size > 10 * 1024 * 1024) throw new ApiError(400, 'Image too large (max 10 MB)')
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${docId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('doc-images').upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
      contentType: file.type,
    })
    if (error) throw new ApiError(400, `Upload failed: ${error.message}`)
    return supabase.storage.from('doc-images').getPublicUrl(path).data.publicUrl
  },
}
