-- Document version history (Option A: Yjs snapshots).
--
-- Content lives in the Yjs/LevelDB layer, not Postgres. A "version" is a full
-- Yjs state update (Y.encodeStateAsUpdate) captured at a point in time, stored
-- as bytea here so it is durable and queryable alongside the rest of the doc
-- metadata. Restoring = applying this update back onto the live Y.Doc client
-- side. The snapshot bytes are produced by the already-synced browser client
-- and written through the service-role server endpoint (which authorizes the
-- caller), so these RLS policies are a defense-in-depth backstop.

create table if not exists document_version (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id) on delete cascade,
  label       text,
  update_blob bytea not null,                       -- Y.encodeStateAsUpdate(ydoc)
  created_by  uuid references app_user(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists document_version_doc_idx
  on document_version(document_id, created_at desc);

alter table document_version enable row level security;

-- Anyone who can access the document may read its version list.
drop policy if exists document_version_select on document_version;
create policy document_version_select on document_version
for select using ( can_access(document_id, auth.uid()) );

-- Editors (owner / EDITOR / MANAGER) may create a version.
drop policy if exists document_version_insert on document_version;
create policy document_version_insert on document_version
for insert with check ( can_edit(document_id, auth.uid()) );

-- Editors may prune old versions.
drop policy if exists document_version_delete on document_version;
create policy document_version_delete on document_version
for delete using ( can_edit(document_id, auth.uid()) );
