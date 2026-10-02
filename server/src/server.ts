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
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }))
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
