import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

/**
 * Scope C auth: identity is owned by Supabase Auth. The client logs in with
 * @supabase/supabase-js and sends the resulting access token (a JWT) as a
 * Bearer header. We VERIFY that token here — we never mint our own.
 *
 * Supabase signs access tokens with HS256 using the project's JWT secret
 * (Settings → API → JWT Secret). Set it as SUPABASE_JWT_SECRET on the server.
 * The token's `sub` claim is the Supabase user id; `email` is in the claims.
 */

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? ''

export type SessionUser = { id: string; email: string }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser
    }
  }
}

/** Verify a Supabase access token. Returns the user or null. */
export function verifyToken(token: string): SessionUser | null {
  if (!SUPABASE_JWT_SECRET) {
    console.warn('SUPABASE_JWT_SECRET is not set — all tokens will be rejected.')
    return null
  }
  try {
    const payload = jwt.verify(token, SUPABASE_JWT_SECRET, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload
    const id = payload.sub
    const email = (payload.email as string) ?? (payload.user_metadata as any)?.email ?? ''
    if (!id) return null
    return { id, email }
  } catch {
    return null
  }
}

/** Pull a Bearer token from the Authorization header. */
function bearer(req: Request): string | null {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) return null
  return h.slice('Bearer '.length).trim()
}

export function userFromRequest(req: Request): SessionUser | null {
  const token = bearer(req)
  if (!token) return null
  return verifyToken(token)
}

/** Middleware: 401 unless a valid Supabase token is present. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = userFromRequest(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated' })
  req.user = user
  next()
}
