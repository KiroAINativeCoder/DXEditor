import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { prisma } from './db.js'
import {
  hashPassword,
  verifyPassword,
  signToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
} from './auth.js'
import { getAccess, canEdit } from './access.js'

const app = express()
const PORT = Number(process.env.PORT ?? 4000)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'

// credentials:true + explicit origin so the session cookie flows cross-port.
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }))
app.use(express.json({ limit: '5mb' }))
app.use(cookieParser())

app.get('/health', (_req, res) => res.json({ ok: true }))

// ---------------------------------------------------------------- auth

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Email and a 6+ char password are required' })
  }
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return res.status(409).json({ error: 'Email already registered' })

  const user = await prisma.user.create({
    data: { email, name: name ?? null, passwordHash: await hashPassword(password) },
  })
  setSessionCookie(res, signToken({ id: user.id, email: user.email }))
  res.status(201).json({ id: user.id, email: user.email, name: user.name })
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  const user = await prisma.user.findUnique({ where: { email: String(email) } })
  if (!user || !(await verifyPassword(String(password), user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }
  setSessionCookie(res, signToken({ id: user.id, email: user.email }))
  res.json({ id: user.id, email: user.email, name: user.name })
})

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res)
  res.status(204).end()
})

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, name: true },
  })
  if (!user) return res.status(401).json({ error: 'Not authenticated' })
  res.json(user)
})

// The session cookie is httpOnly (unreadable by JS), but the collab WebSocket
// needs a token in its query string. Issue a fresh short-lived one here.
app.get('/api/auth/ws-token', requireAuth, (req, res) => {
  res.json({ token: signToken({ id: req.user!.id, email: req.user!.email }) })
})

// ------------------------------------------------------------- documents
// All document routes require auth and are scoped to owned + shared docs.

// List documents the user owns OR that are shared with them.
app.get('/api/documents', requireAuth, async (req, res) => {
  const uid = req.user!.id
  const docs = await prisma.document.findMany({
    where: { OR: [{ ownerId: uid }, { memberships: { some: { userId: uid } } }] },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, ownerId: true, createdAt: true, updatedAt: true },
  })
  res.json(docs.map((d) => ({ ...d, isOwner: d.ownerId === uid })))
})

app.get('/api/documents/:id', requireAuth, async (req, res) => {
  const access = await getAccess(req.user!.id, String(req.params.id))
  if (!access) return res.status(404).json({ error: 'Document not found' })
  const doc = await prisma.document.findUnique({
    where: { id: String(req.params.id) },
    select: { id: true, title: true, ownerId: true, createdAt: true, updatedAt: true },
  })
  res.json({ ...doc, role: access.role })
})

app.post('/api/documents', requireAuth, async (req, res) => {
  const { title } = req.body ?? {}
  const doc = await prisma.document.create({
    data: {
      title: typeof title === 'string' && title.trim() ? title : 'Untitled document',
      ownerId: req.user!.id,
    },
  })
  res.status(201).json({ ...doc, role: 'OWNER' })
})

app.put('/api/documents/:id', requireAuth, async (req, res) => {
  const access = await getAccess(req.user!.id, String(req.params.id))
  if (!access) return res.status(404).json({ error: 'Document not found' })
  if (!canEdit(access)) return res.status(403).json({ error: 'Read-only access' })

  const { title } = req.body ?? {}
  if (typeof title !== 'string') return res.status(400).json({ error: 'title required' })
  const doc = await prisma.document.update({
    where: { id: String(req.params.id) },
    data: { title },
  })
  res.json(doc)
})

app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  const access = await getAccess(req.user!.id, String(req.params.id))
  if (access?.role !== 'OWNER') {
    return res.status(403).json({ error: 'Only the owner can delete a document' })
  }
  await prisma.document.delete({ where: { id: String(req.params.id) } })
  res.status(204).end()
})

// ---------------------------------------------------------------- sharing

// List who a document is shared with (owner only).
app.get('/api/documents/:id/shares', requireAuth, async (req, res) => {
  const access = await getAccess(req.user!.id, String(req.params.id))
  if (access?.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' })
  const shares = await prisma.membership.findMany({
    where: { documentId: String(req.params.id) },
    select: { id: true, role: true, user: { select: { id: true, email: true, name: true } } },
  })
  res.json(shares)
})

// Share a document with a user by email (owner only).
app.post('/api/documents/:id/shares', requireAuth, async (req, res) => {
  const access = await getAccess(req.user!.id, String(req.params.id))
  if (access?.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' })

  const { email, role } = req.body ?? {}
  const target = await prisma.user.findUnique({ where: { email: String(email) } })
  if (!target) return res.status(404).json({ error: 'No user with that email' })
  if (target.id === req.user!.id) return res.status(400).json({ error: "You already own this" })

  const normalizedRole = role === 'VIEWER' ? 'VIEWER' : 'EDITOR'
  const share = await prisma.membership.upsert({
    where: { documentId_userId: { documentId: String(req.params.id), userId: target.id } },
    create: { documentId: String(req.params.id), userId: target.id, role: normalizedRole },
    update: { role: normalizedRole },
    select: { id: true, role: true, user: { select: { id: true, email: true, name: true } } },
  })
  res.status(201).json(share)
})

// Revoke a share (owner only).
app.delete('/api/documents/:id/shares/:userId', requireAuth, async (req, res) => {
  const access = await getAccess(req.user!.id, String(req.params.id))
  if (access?.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' })
  await prisma.membership
    .delete({ where: { documentId_userId: { documentId: String(req.params.id), userId: String(req.params.userId) } } })
    .catch(() => undefined)
  res.status(204).end()
})

app.listen(PORT, () => {
  console.log(`DXEditor API listening on http://localhost:${PORT}`)
})
