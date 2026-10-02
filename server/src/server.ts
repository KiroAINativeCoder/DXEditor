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
