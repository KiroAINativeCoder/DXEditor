-- Folders for organizing documents.
--
-- A folder is owned by one user and groups that user's documents. Documents
-- carry a nullable folder_id (null = "unfiled"). Folders are per-owner and
-- private to the owner (sharing a document does not share the owner's folder
-- structure — a collaborator just sees the shared doc unfiled on their side).
-- parent_id is reserved for future nesting; the current UI is flat.

create table if not exists folder (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'New folder',
  owner_id   uuid not null references app_user(id) on delete cascade,
  parent_id  uuid references folder(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists folder_owner_idx on folder(owner_id);

alter table folder enable row level security;

-- A user sees and manages only their own folders.
drop policy if exists folder_select on folder;
create policy folder_select on folder
for select using ( owner_id = auth.uid() );

drop policy if exists folder_insert on folder;
create policy folder_insert on folder
for insert with check ( owner_id = auth.uid() );

drop policy if exists folder_update on folder;
create policy folder_update on folder
for update using ( owner_id = auth.uid() ) with check ( owner_id = auth.uid() );

drop policy if exists folder_delete on folder;
create policy folder_delete on folder
for delete using ( owner_id = auth.uid() );

-- Attach documents to a folder. ON DELETE SET NULL so deleting a folder just
-- unfiles its documents rather than destroying them.
alter table document
  add column if not exists folder_id uuid references folder(id) on delete set null;
create index if not exists document_folder_idx on document(folder_id);
