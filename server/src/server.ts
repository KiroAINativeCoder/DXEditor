import express from 'express'
import cors from 'cors'
import { Prisma } from '@prisma/client'
import { prisma } from './db.js'

const app = express()
const PORT = Number(process.env.PORT ?? 4000)

app.use(cors())
app.use(express.json({ limit: '5mb' })) // documents can be large

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

// List documents (most recently updated first). Metadata only — no content.
app.get('/api/documents', async (_req, res) => {
  const docs = await prisma.document.findMany({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  })
  res.json(docs)
})

// Get one document (with content)
app.get('/api/documents/:id', async (req, res) => {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } })
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  res.json(doc)
})

// Create a document
app.post('/api/documents', async (req, res) => {
  const { title, content } = req.body ?? {}
  const doc = await prisma.document.create({
    data: {
      title: typeof title === 'string' && title.trim() ? title : 'Untitled document',
      content: content ?? emptyDoc(),
    },
  })
  res.status(201).json(doc)
})

// Update a document (title and/or content)
app.put('/api/documents/:id', async (req, res) => {
  const { title, content } = req.body ?? {}
  const data: Prisma.DocumentUpdateInput = {}
  if (typeof title === 'string') data.title = title
  if (content !== undefined) data.content = content as Prisma.InputJsonValue

  try {
    const doc = await prisma.document.update({
      where: { id: req.params.id },
      data,
    })
    res.json(doc)
  } catch {
    res.status(404).json({ error: 'Document not found' })
  }
})

// Delete a document
app.delete('/api/documents/:id', async (req, res) => {
  try {
    await prisma.document.delete({ where: { id: req.params.id } })
    res.status(204).end()
  } catch {
    res.status(404).json({ error: 'Document not found' })
  }
})

// An empty ProseMirror/Tiptap document.
function emptyDoc() {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

app.listen(PORT, () => {
  console.log(`DXEditor API listening on http://localhost:${PORT}`)
})
