import { prisma } from './db.js'

export type Access = { role: 'OWNER' | 'EDITOR' | 'VIEWER' } | null

/**
 * Resolve a user's access to a document:
 *   OWNER  — they own it (full control incl. sharing/delete)
 *   EDITOR — shared with edit rights
 *   VIEWER — shared read-only
 *   null   — no access
 */
export async function getAccess(userId: string, documentId: string): Promise<Access> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { ownerId: true },
  })
  if (!doc) return null
  if (doc.ownerId === userId) return { role: 'OWNER' }

  const membership = await prisma.membership.findUnique({
    where: { documentId_userId: { documentId, userId } },
    select: { role: true },
  })
  if (!membership) return null
  return { role: membership.role }
}

export function canEdit(access: Access): boolean {
  return access?.role === 'OWNER' || access?.role === 'EDITOR'
}
