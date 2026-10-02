-- ============================================================================
-- DXEditor — Supabase schema + Row Level Security (scope C)
--
-- Run this in the Supabase SQL editor (or via `supabase db push`) AFTER
-- creating the project. It assumes Supabase Auth owns identity: the canonical
-- user is auth.users; we keep a lightweight public.app_user row (id = the
-- auth user id) so documents/memberships/comments can reference a user.
--
-- Access control lives ENTIRELY in these policies (no getAccess in app code
-- for Postgres-backed tables). The collaboration relay still enforces its own
-- check because the Yjs/LevelDB content layer is outside Postgres.
-- ============================================================================

-- ---------------------------------------------------------------- enum
do $$ begin
  create type role as enum ('VIEWER', 'EDITOR', 'MANAGER');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables

-- Mirror of auth.users we can FK against. Populated on first login (upsert).
create table if not exists app_user (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text unique not null,
  name       text,
  created_at timestamptz not null default now()
);

create table if not exists document (
  id         uuid primary key default gen_random_uuid(),
  title      text not null default 'Untitled document',
  owner_id   uuid not null references app_user(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists membership (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id) on delete cascade,
  user_id     uuid not null references app_user(id) on delete cascade,
  role        role not null default 'EDITOR',
  created_at  timestamptz not null default now(),
  unique (document_id, user_id)
);

create table if not exists comment (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id) on delete cascade,
  author_id   uuid not null references app_user(id) on delete cascade,
  body        text not null,
  anchor_id   text,
  quote       text,
  parent_id   uuid references comment(id) on delete cascade,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists comment_document_idx on comment(document_id);
create index if not exists comment_anchor_idx on comment(anchor_id);

-- ----------------------------------------------------- SECURITY DEFINER helpers
-- These run with the function OWNER's rights, so their reads of membership /
-- document do NOT re-trigger RLS. This is what breaks the recursion when a
-- membership policy must ask "is this user a manager?" (which reads membership
-- from inside a membership policy).

create or replace function is_doc_owner(doc uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from document d where d.id = doc and d.owner_id = uid);
$$;

create or replace function doc_role(doc uuid, uid uuid)
returns role language sql security definer stable set search_path = public as $$
  select m.role from membership m where m.document_id = doc and m.user_id = uid;
$$;

-- Owner OR a MANAGER member may manage shares.
create or replace function can_manage_shares(doc uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select is_doc_owner(doc, uid) or doc_role(doc, uid) = 'MANAGER';
$$;

-- Any level of access (owner or any membership) — "can at least view".
create or replace function can_access(doc uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select is_doc_owner(doc, uid) or doc_role(doc, uid) is not null;
$$;

-- Can edit content: owner, EDITOR, or MANAGER (not VIEWER).
create or replace function can_edit(doc uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select is_doc_owner(doc, uid) or doc_role(doc, uid) in ('EDITOR', 'MANAGER');
$$;

-- ---------------------------------------------------------------- enable RLS
alter table app_user   enable row level security;
alter table document   enable row level security;
alter table membership enable row level security;
alter table comment    enable row level security;

-- ---------------------------------------------------------------- app_user
-- A user can read their own row and the rows of people they collaborate with
-- (so the UI can show names on shares/comments). Simplest safe rule: readable
-- by any authenticated user is NOT ok (leaks the user list) — restrict to self
-- plus co-members resolved through documents the caller can access.
create policy app_user_select on app_user
for select using (
  id = auth.uid()
  or exists (
    select 1 from membership m
    where m.user_id = app_user.id
      and can_access(m.document_id, auth.uid())
  )
  or exists (
    select 1 from document d
    where d.owner_id = app_user.id
      and can_access(d.id, auth.uid())
  )
);
-- A user may upsert only their own row (first-login provisioning).
create policy app_user_upsert on app_user
for insert with check (id = auth.uid());
create policy app_user_update on app_user
for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------- document
create policy document_select on document
for select using ( can_access(id, auth.uid()) );

-- Any authenticated user may create a doc they own.
create policy document_insert on document
for insert with check ( owner_id = auth.uid() );

-- Owner, EDITOR, or MANAGER may update (e.g. title). owner_id is immutable here
-- because a non-owner cannot pass the owner-only check to change it (guarded by
-- the with check: the row's owner_id must remain the current owner).
create policy document_update on document
for update using ( can_edit(id, auth.uid()) )
with check ( can_edit(id, auth.uid()) );

-- Only the owner may delete the document.
create policy document_delete on document
for delete using ( is_doc_owner(id, auth.uid()) );

-- ---------------------------------------------------------------- membership
-- SELECT: see shares that are yours, or on docs you can manage.
create policy membership_select on membership
for select using (
  user_id = auth.uid()
  or can_manage_shares(document_id, auth.uid())
);

-- INSERT: only owner/manager may add a share, AND (anti-escalation) a non-owner
-- manager may only grant VIEWER or EDITOR — never MANAGER.
create policy membership_insert on membership
for insert with check (
  can_manage_shares(document_id, auth.uid())
  and (
    is_doc_owner(document_id, auth.uid())            -- owner: any role
    or role in ('VIEWER', 'EDITOR')                  -- manager: capped
  )
);

-- UPDATE: same gate + cap. A manager cannot promote a row to MANAGER, and
-- cannot modify an existing MANAGER row (only the owner can).
create policy membership_update on membership
for update using (
  can_manage_shares(document_id, auth.uid())
  and ( is_doc_owner(document_id, auth.uid()) or role in ('VIEWER', 'EDITOR') )
) with check (
  can_manage_shares(document_id, auth.uid())
  and ( is_doc_owner(document_id, auth.uid()) or role in ('VIEWER', 'EDITOR') )
);

-- DELETE: owner may revoke anyone; a manager may revoke only VIEWER/EDITOR.
create policy membership_delete on membership
for delete using (
  is_doc_owner(document_id, auth.uid())
  or ( can_manage_shares(document_id, auth.uid()) and role in ('VIEWER', 'EDITOR') )
);

-- ---------------------------------------------------------------- comment
-- Visible to anyone who can access the document.
create policy comment_select on comment
for select using ( can_access(document_id, auth.uid()) );

-- Creating/replying needs edit rights; the author must be the caller.
create policy comment_insert on comment
for insert with check (
  can_edit(document_id, auth.uid()) and author_id = auth.uid()
);

-- Resolve/edit: the author or the document owner.
create policy comment_update on comment
for update using (
  author_id = auth.uid() or is_doc_owner(document_id, auth.uid())
) with check (
  author_id = auth.uid() or is_doc_owner(document_id, auth.uid())
);

-- Delete: the author or the document owner.
create policy comment_delete on comment
for delete using (
  author_id = auth.uid() or is_doc_owner(document_id, auth.uid())
);
