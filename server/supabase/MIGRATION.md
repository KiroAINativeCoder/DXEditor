# Supabase migration (scope C) — status & setup

This branch (`feat/supabase-rls`) migrates DXEditor to **Supabase Auth +
Postgres + Row Level Security**, and adds a **MANAGER** role (can share, cannot
delete/own). Work in progress — see "Remaining" below.

## What this changes

- **Identity** → Supabase Auth (email/password, OAuth-ready). We stop minting
  our own JWT; the server **verifies** Supabase access tokens.
- **Metadata** (documents, memberships, comments) → **Supabase Postgres**,
  accessed **directly from the browser** via `@supabase/supabase-js`.
- **Access control** → **RLS policies** in `server/supabase/schema.sql` (no
  `getAccess` for client paths).
- **Roles** → `VIEWER | EDITOR | MANAGER`. A MANAGER may share (grant VIEWER/
  EDITOR only) but cannot delete the doc, remove the owner, or create managers.
- **Collaboration relay** → still enforces its own access check (RLS can't guard
  the Yjs/LevelDB content layer), now via the Supabase **service-role** client.

## One-time setup (you do this)

1. Create a project at supabase.com (free tier).
2. Project → SQL editor → run **`server/supabase/schema.sql`** (creates tables,
   the `SECURITY DEFINER` helper functions, and all RLS policies).
3. Project → Settings → API. Copy into env files:
   - `client/.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - `server/.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
4. Enable email/password auth (Authentication → Providers). For local testing
   you may want to disable email confirmation.

## Why RLS needed the SECURITY DEFINER helpers

The MANAGER tier means the **membership** policy must ask "is this user a
MANAGER?" — which reads `membership` from inside a `membership` policy
(self-referential → recursion). The helper functions (`is_doc_owner`,
`doc_role`, `can_manage_shares`, …) run as `security definer`, so their reads
bypass RLS and break the loop. The owner check reads `document.owner_id` (a
different table), so ownership stays the un-forgeable, recursion-free root.

## Status

Done:
- `server/supabase/schema.sql` — full DDL + helpers + RLS (incl. MANAGER caps)
- `server/src/auth.ts` — verifies Supabase asymmetric JWTs via remote JWKS
- `server/src/access.ts` — relay access check via service role (incl. MANAGER)
- `server/src/server.ts` — slimmed: health, `/api/auth/sync`, `/api/auth/ws-token`
- `server/src/env.ts` — loads `.env` (dotenv) before Supabase clients init
- `client/src/lib/supabase.ts` — browser Supabase client
- `client/src/lib/api.ts` — data layer rewritten to query Supabase under RLS
- **All client components migrated** to the new API (`auth`/`docs`/`shares`/
  `comments`) + snake_case fields + MANAGER role. **Client builds clean.**
- ShareDialog offers "Can manage" (MANAGER) to owners; the relay reads the
  Supabase access token from the WS `?token=` param.

## Remaining

- **Disable email confirmation** in Supabase → Authentication → Providers →
  Email (the project has no SMTP), so signup returns a session for testing.
- End-to-end verification against the live project (owner/editor/viewer/manager
  flows, RLS enforcement, collab).
- Retire Prisma/SQLite (`server/prisma`, `server/src/db.ts`) once verified.
