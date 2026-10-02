import './env.js'
import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './auth.js'

/**
 * Scope C server: thin. Supabase Postgres + RLS now own all document / comment
 * / membership data — the browser reads and writes it DIRECTLY via
 * @supabase/supabase-js, with RLS enforcing access. This Express service keeps
 * only what cannot live in the client:
 *   - /health
 *   - /api/auth/sync   provision/refresh the caller's app_user row on login
 *   - /api/auth/ws-token  hand the collab relay a verified token (the relay is
 *                         a raw WebSocket; it reads the token from the query)
 *
 * The relay (collab.ts) authorizes document access with the service-role key.
 */

const app = express()
const PORT = Number(process.env.PORT ?? 4000)
// Allow the dev client regardless of which loopback spelling the browser uses.
// Vite listens on [::1]:5173 but can be reached as localhost / 127.0.0.1 / [::1],
// and each spelling is a DISTINCT Origin for CORS. Pinning a single string meant
// a session opened on http://127.0.0.1:5173 had its credentialed fetches
// (lookup + share) blocked, surfacing as a generic "Failed to share" in the UI.
// Loopback is ALWAYS allowed (dev); a non-loopback CLIENT_ORIGIN (prod) is
// allowed in addition to it.
const EXPLICIT_ORIGIN = process.env.CLIENT_ORIGIN
const LOOPBACK_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

app.use(
  cors({
    credentials: true,
    origin: (origin, cb) => {
      // Non-browser clients (curl, same-origin, server-to-server) send no Origin.
      if (!origin) return cb(null, true)
      // With credentials:true the allowed origin must be reflected back as the
      // exact string — returning boolean true makes cors emit "*", which the
      // browser rejects for credentialed requests. So echo `origin` when allowed.
      const ok = LOOPBACK_RE.test(origin) || (!!EXPLICIT_ORIGIN && origin === EXPLICIT_ORIGIN)
      return cb(null, ok ? origin : false)
    },
  }),
)
app.use(express.json({ limit: '1mb' }))

const admin = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
)

app.get('/health', (_req, res) => res.json({ ok: true }))

// Provision (or refresh) the caller's app_user row. Called by the client right
// after login so documents/memberships/comments can FK to a user row. Uses the
// service role to upsert, keyed by the verified Supabase user id.
app.post('/api/auth/sync', requireAuth, async (req, res) => {
  const { id, email } = req.user!
  const name = typeof req.body?.name === 'string' ? req.body.name : null
  const { error } = await admin
    .from('app_user')
    .upsert({ id, email, name }, { onConflict: 'id' })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ id, email, name })
})

// Resolve a user by email for sharing. Done server-side with the service role
// because app_user RLS only lets a caller see themselves + existing
// collaborators — so a client-side lookup of someone you haven't shared with
// yet returns nothing (chicken-and-egg). Only an authenticated user may call
// this, and it returns just the id/email/name needed to create a share.
app.get('/api/users/lookup', requireAuth, async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim() : ''
  if (!email) return res.status(400).json({ error: 'email required' })
  const { data, error } = await admin
    .from('app_user')
    .select('id,email,name')
    .eq('email', email)
    .maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'No user with that email' })
  res.json(data)
})

// Create/update a share. The membership insert is done server-side with the
// service role to avoid client-token/RLS timing fragility, but we FIRST verify
// the caller is OWNER (or MANAGER) of the document, preserving the same
// authorization the RLS policy enforces.
app.post('/api/docs/:id/shares', requireAuth, async (req, res) => {
  const callerId = req.user!.id
  const docId = req.params.id
  const targetUserId = typeof req.body?.userId === 'string' ? req.body.userId : ''
  const role = typeof req.body?.role === 'string' ? req.body.role : ''
  if (!targetUserId || !['VIEWER', 'EDITOR', 'MANAGER'].includes(role)) {
    return res.status(400).json({ error: 'userId and a valid role are required' })
  }
  if (targetUserId === callerId) {
    return res.status(400).json({ error: 'You already have access to this document' })
  }

  // Authorize: caller must own the doc, or hold a MANAGER membership on it.
  const { data: doc, error: docErr } = await admin
    .from('document')
    .select('owner_id')
    .eq('id', docId)
    .maybeSingle()
  if (docErr) return res.status(500).json({ error: docErr.message })
  if (!doc) return res.status(404).json({ error: 'Document not found' })

  let canManage = doc.owner_id === callerId
  if (!canManage) {
    const { data: mem } = await admin
      .from('membership')
      .select('role')
      .eq('document_id', docId)
      .eq('user_id', callerId)
      .maybeSingle()
    canManage = mem?.role === 'MANAGER'
  }
  if (!canManage) return res.status(403).json({ error: 'Only the owner or a manager can share' })

  const { error } = await admin
    .from('membership')
    .upsert({ document_id: docId, user_id: targetUserId, role }, { onConflict: 'document_id,user_id' })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

// List a document's comments with author details resolved via the service
// role. Reading comments through supabase-js directly leaves the author join
// null for any commenter whose app_user row RLS hides from the reader (e.g. a
// collaborator added by someone else) — which both looks wrong and crashed the
// client. We verify the caller can access the doc, then return resolved rows.
app.get('/api/docs/:id/comments', requireAuth, async (req, res) => {
  const callerId = req.user!.id
  const docId = req.params.id

  // Authorize: owner or any membership on the doc.
  const { data: doc } = await admin.from('document').select('owner_id').eq('id', docId).maybeSingle()
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  let allowed = doc.owner_id === callerId
  if (!allowed) {
    const { data: mem } = await admin
      .from('membership')
      .select('user_id')
      .eq('document_id', docId)
      .eq('user_id', callerId)
      .maybeSingle()
    allowed = !!mem
  }
  if (!allowed) return res.status(403).json({ error: 'No access to this document' })

  const { data, error } = await admin
    .from('comment')
    .select('*, author:app_user(id,email,name)')
    .eq('document_id', docId)
    .order('created_at', { ascending: true })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data ?? [])
})

// The collab relay is a raw WebSocket and reads its token from the query
// string. The browser already holds a Supabase access token; this endpoint
// simply echoes the verified identity so the client knows the token is good
// (and provides a single place to later swap in a scoped, short-lived token).
app.get('/api/auth/ws-token', requireAuth, (req, res) => {
  // The client passes its Supabase access token to the relay directly; we
  // return the verified identity as a confirmation. (The relay verifies the
  // same token itself on connect.)
  res.json({ user: req.user })
})

app.listen(PORT, () => {
  console.log(`DXEditor API (scope C) listening on http://localhost:${PORT}`)
})
