import type { Request, Response, NextFunction } from 'express'
import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * Scope C auth: identity is owned by Supabase Auth. The browser logs in with
 * @supabase/supabase-js and sends the resulting access token (a JWT) as a
 * Bearer header. We VERIFY that token — we never mint one.
 *
 * This project uses Supabase's NEW asymmetric signing keys (sb_publishable_ /
 * sb_secret_ API keys), so access tokens are signed RS256/ES256 and verified
 * against the project's public JWKS endpoint (no shared secret to hold):
 *   https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
 * `createRemoteJWKSet` fetches and caches those public keys.
 */

const JWKS_URL = process.env.SUPABASE_JWKS_URL ?? ''
const ISSUER = process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL}/auth/v1` : undefined

const jwks = JWKS_URL ? createRemoteJWKSet(new URL(JWKS_URL)) : null

export type SessionUser = { id: string; email: string }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser
    }
  }
}

/** Verify a Supabase access token via JWKS. Returns the user or null. */
export async function verifyToken(token: string): Promise<SessionUser | null> {
  if (!jwks) {
    console.warn('SUPABASE_JWKS_URL is not set — all tokens will be rejected.')
    return null
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: ISSUER,
      // Supabase access tokens carry aud "authenticated".
      audience: 'authenticated',
    })
    const id = typeof payload.sub === 'string' ? payload.sub : ''
    const email = (payload.email as string) ?? ''
    if (!id) return null
    return { id, email }
  } catch {
    return null
  }
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) return null
  return h.slice('Bearer '.length).trim()
}

/** Middleware: 401 unless a valid Supabase token is present. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearer(req)
  const user = token ? await verifyToken(token) : null
  if (!user) return res.status(401).json({ error: 'Not authenticated' })
  req.user = user
  next()
}
