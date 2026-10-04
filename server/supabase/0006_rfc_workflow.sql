-- ============================================================================
-- DXEditor — RFC / design-doc workflow (Phases 1-3)
--
-- Phase 1  doc_type + status lifecycle on `document`
-- Phase 3  `review` table (approve / request-changes, PR-style)
--
-- Run in the Supabase SQL editor (or `supabase db push`) AFTER schema.sql.
-- Reuses the SECURITY DEFINER helpers from schema.sql (can_access / can_edit /
-- is_doc_owner) so the policies here do not re-trigger RLS recursion.
-- ============================================================================

-- ---------------------------------------------------------------- enums
do $$ begin
  create type doc_type as enum ('DOC', 'RFC', 'ADR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type doc_status as enum ('DRAFT', 'PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_state as enum ('APPROVED', 'CHANGES_REQUESTED');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- Phase 1: document columns
alter table document add column if not exists doc_type        doc_type   not null default 'DOC';
alter table document add column if not exists status          doc_status not null default 'DRAFT';
-- Optional pointer to the RFC that supersedes this one (set when status flips
-- to SUPERSEDED). Self-reference, nulled if the target doc is deleted.
alter table document add column if not exists superseded_by   uuid references document(id) on delete set null;

-- (document_update policy from schema.sql already gates these columns to
--  owner / EDITOR / MANAGER via can_edit — no new document policy needed.)

-- ---------------------------------------------------------------- Phase 3: review table
create table if not exists review (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id) on delete cascade,
  reviewer_id uuid not null references app_user(id) on delete cascade,
  state       review_state not null,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (document_id, reviewer_id)   -- one (latest) review per reviewer per doc
);
create index if not exists review_document_idx on review(document_id);

alter table review enable row level security;

-- SELECT: anyone who can access the document sees its reviews.
drop policy if exists review_select on review;
create policy review_select on review
for select using ( can_access(document_id, auth.uid()) );

-- INSERT: a reviewer records their OWN review, and must be able to access the
-- doc (viewers can review too — approving a design doc does not require edit).
drop policy if exists review_insert on review;
create policy review_insert on review
for insert with check (
  can_access(document_id, auth.uid()) and reviewer_id = auth.uid()
);

-- UPDATE: a reviewer may change only their own review.
drop policy if exists review_update on review;
create policy review_update on review
for update using ( reviewer_id = auth.uid() )
with check ( reviewer_id = auth.uid() );

-- DELETE: a reviewer may withdraw their own review; the doc owner may clear any.
drop policy if exists review_delete on review;
create policy review_delete on review
for delete using (
  reviewer_id = auth.uid() or is_doc_owner(document_id, auth.uid())
);
