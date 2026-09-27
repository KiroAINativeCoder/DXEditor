import { PrismaClient } from '@prisma/client'

// Single shared instance across the app.
export const prisma = new PrismaClient()
