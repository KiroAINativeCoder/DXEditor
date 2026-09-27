import type { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-insecure-secret-change-me'
const COOKIE = 'dx_session'
const TOKEN_TTL = '7d'

export type SessionUser = { id: string; email: string }

// Extend Express Request with the authenticated user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser
    }
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export function signToken(user: SessionUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: TOKEN_TTL })
}

export function verifyToken(token: string): SessionUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload & SessionUser
    return { id: payload.id, email: payload.email }
  } catch {
    return null
  }
}

/** Set the session cookie on a response. */
export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE)
}

/** Read + verify the session token from the request cookie. */
export function userFromRequest(req: Request): SessionUser | null {
  const token = req.cookies?.[COOKIE]
  if (!token) return null
  return verifyToken(token)
}

/** Middleware: 401 unless a valid session is present. Populates req.user. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = userFromRequest(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated' })
  req.user = user
  next()
}

export { COOKIE as SESSION_COOKIE, JWT_SECRET }
