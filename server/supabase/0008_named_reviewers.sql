-- ============================================================================
-- DXEditor — review workflow v2 (named mandatory reviewers)
--
-- Supersedes 0007 (approval-count threshold) — that migration was never run.
-- Changes from 0006:
--   * add IN_REVIEW to the doc_status lifecycle
--   * reviews only matter while a doc is IN_REVIEW
--   * mandatory reviewers are NAMED (doc_reviewer), chosen from existing members
--   * doc_type is no longer used by the app (every doc has the lifecycle); the
--     column is left in place but defaults/ignored — dropping an enum-typed
--     column is destructive, so we simply stop reading it.
--
-- Run in the Supabase SQL editor after 0006_rfc_workflow.sql.
-- ============================================================================

-- ---------------------------------------------------------------- IN_REVIEW status
-- Postgres can ADD an enum value in its own statement (not inside a txn block
-- with other DDL on some PG versions, so keep this standalone).
do $$ begin
  alter type doc_status add value if not exists 'IN_REVIEW' after 'DRAFT';
exception when others then null; end $$;

-- ---------------------------------------------------------------- doc_reviewer
-- A named mandatory reviewer on a document. Only people who already have access
-- (owner or a membership) should be added — enforced in the app when picking,
-- and the FK guarantees the user exists. Approval of ALL rows here (with no
-- changes-requested) is what gates ACCEPTED.
create table if not exists doc_reviewer (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id) on delete cascade,
  user_id     uuid not null references app_user(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (document_id, user_id)
);
create index if not exists doc_reviewer_document_idx on doc_reviewer(document_id);

alter table doc_reviewer enable row level security;

-- SELECT: anyone who can access the doc sees who the required reviewers are.
drop policy if exists doc_reviewer_select on doc_reviewer;
create policy doc_reviewer_select on doc_reviewer
for select using ( can_access(document_id, auth.uid()) );

-- INSERT/DELETE: only the owner or a MANAGER manages the reviewer list — reuse
-- the same gate that governs sharing (can_manage_shares).
drop policy if exists doc_reviewer_insert on doc_reviewer;
create policy doc_reviewer_insert on doc_reviewer
for insert with check ( can_manage_shares(document_id, auth.uid()) );

drop policy if exists doc_reviewer_delete on doc_reviewer;
create policy doc_reviewer_delete on doc_reviewer
for delete using ( can_manage_shares(document_id, auth.uid()) );
